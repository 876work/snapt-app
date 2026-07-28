import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { reassignBooking, offerWindowMs } from '../offers.js';
import { notify } from '../notify.js';
import { decryptField } from '../crypto.js';
import { sendEmail } from '../email.js';

// Admin Portal (handoff §15) — Phase 5 foundation. Sits on the SAME backend
// and data model as the apps (§15 mandate), served as a responsive single
// page at /admin, authenticated with ADMIN_API_TOKEN (real admin accounts
// come with the full portal build-out). Covers: alert queues (SOS first),
// dispute review/resolution, creator application vetting, per-creator strike
// history + overturn. Remaining §15 scope (fee settings UI, analytics,
// moderation, legal CMS, manual dispatch) is tracked in the README.

export function registerAdminRoutes(app: FastifyInstance) {
  app.get('/v1/admin/alerts', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('admin_alerts')
      .select('*')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    // SOS first — the queue is escalation-tiered, not chronological (§13/§15).
    const priority = (t: string) => (t === 'sos' ? 0 : t === 'session_ended_safety' ? 1 : 2);
    return { alerts: (data ?? []).sort((a, b) => priority(a.alert_type) - priority(b.alert_type)) };
  });

  app.post<{ Params: { id: string } }>('/v1/admin/alerts/:id/resolve', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    await supabaseAdmin
      .from('admin_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', request.params.id);
    await audit(adminId, 'alert_resolved', request.params.id);
    return { resolved: true };
  });

  app.get('/v1/admin/disputes', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('disputes')
      .select('*, dispute_evidence(id, submitted_by, kind, content, created_at)')
      .not('status', 'in', '(resolved,closed)')
      .order('created_at', { ascending: true });
    return { disputes: data ?? [] };
  });

  app.get('/v1/admin/applications', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('creator_profiles')
      .select('user_id, specialties, base_area, vetting_status, created_at, profiles!inner(full_name, email)')
      .eq('vetting_status', 'in_review')
      .order('created_at', { ascending: true });
    return { applications: data ?? [] };
  });

  // §15 fee/promo settings: every app_config row is admin-editable.
  app.get('/v1/admin/config', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin.from('app_config').select('*').order('key');
    return { config: data ?? [] };
  });
  app.put<{ Params: { key: string }; Body: { value?: unknown; confirmed?: boolean } }>(
    '/v1/admin/config/:key',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const patch: Record<string, unknown> = {};
      if (request.body?.value !== undefined) patch.value = request.body.value;
      if (request.body?.confirmed !== undefined) patch.confirmed = request.body.confirmed;
      const { error } = await supabaseAdmin.from('app_config').update(patch).eq('key', request.params.key);
      if (error) return reply.code(500).send({ error: error.message });
      await audit(adminId, 'config_updated', request.params.key, { value: request.body?.value });
      return { updated: true };
    },
  );

  // §15 analytics: platform counters off the shared data model.
  app.get('/v1/admin/analytics', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const count = async (table: string, filter?: (q: any) => any) => {
      let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
      if (filter) q = filter(q);
      return (await q).count ?? 0;
    };
    const { data: charges } = await supabaseAdmin.from('transactions').select('type, amount_usd');
    const sum = (t: string) =>
      Math.round((charges ?? []).filter((c) => c.type === t).reduce((s, c) => s + Number(c.amount_usd), 0) * 100) / 100;
    return {
      bookings: {
        pending: await count('bookings', (q) => q.eq('status', 'pending')),
        confirmed: await count('bookings', (q) => q.eq('status', 'confirmed')),
        completed: await count('bookings', (q) => q.eq('status', 'completed')),
        cancelled: await count('bookings', (q) => q.eq('status', 'cancelled')),
        disputed: await count('bookings', (q) => q.eq('status', 'disputed')),
      },
      money: { charged_usd: sum('charge'), refunded_usd: sum('refund') },
      creators: {
        approved: await count('creator_profiles', (q) => q.eq('vetting_status', 'approved')),
        in_review: await count('creator_profiles', (q) => q.eq('vetting_status', 'in_review')),
      },
      open_disputes: await count('disputes', (q) => q.not('status', 'in', '(resolved,closed)')),
      active_strikes: await count('strikes', (q) => q.eq('overturned', false).gt('expires_at', new Date().toISOString())),
    };
  });

  // §15 manual dispatch: assign a creator to an unassigned pending booking
  // (goes through the normal accept window, not straight to confirmed).
  app.get('/v1/admin/unassigned', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, occasion, area, scheduled_at, type, declined_creator_ids')
      .eq('status', 'pending')
      .is('creator_id', null)
      .order('created_at', { ascending: true });
    return { bookings: data ?? [] };
  });
  app.post<{ Params: { id: string }; Body: { creator_id?: string } }>(
    '/v1/admin/bookings/:id/assign',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const creatorId = request.body?.creator_id;
      if (!creatorId) return reply.code(400).send({ error: 'creator_id required' });
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('id, status, occasion, area')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!booking || booking.status !== 'pending') {
        return reply.code(409).send({ error: 'Only pending bookings can be dispatched' });
      }
      await supabaseAdmin
        .from('bookings')
        .update({
          creator_id: creatorId,
          offer_expires_at: new Date(Date.now() + (await offerWindowMs())).toISOString(),
        })
        .eq('id', booking.id);
      await notify(creatorId, 'offer_received', 'New job offer',
        `A ${booking.occasion ?? 'session'} booking near ${booking.area ?? 'you'} was assigned to you — accept within the offer window.`);
      await audit(adminId, 'manual_dispatch', booking.id, { creator_id: creatorId });
      return { assigned: true };
    },
  );

  // Manual payout fulfillment queue (no Stripe Connect): requested
  // cash-outs listed with the creator's payout details; admin marks paid
  // after sending money externally — audited with who and when.
  app.get('/v1/admin/payout-requests', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('creator_payouts')
      .select('id, creator_id, amount_usd, created_at')
      .eq('status', 'requested');
    const byCreator = new Map<string, { creator_id: string; total: number; ids: string[] }>();
    for (const p of data ?? []) {
      const e = byCreator.get(p.creator_id) ?? { creator_id: p.creator_id, total: 0, ids: [] as string[] };
      e.total = Math.round((e.total + Number(p.amount_usd)) * 100) / 100;
      e.ids.push(p.id);
      byCreator.set(p.creator_id, e);
    }
    const requests: Record<string, unknown>[] = [];
    for (const e of byCreator.values()) {
      const { data: prof } = await supabaseAdmin.from('profiles').select('full_name, email, phone').eq('id', e.creator_id).single();
      const { data: alert } = await supabaseAdmin
        .from('admin_alerts')
        .select('detail')
        .eq('alert_type', 'payout_requested')
        .is('resolved_at', null)
        .filter('detail->>creator_id', 'eq', e.creator_id)
        .limit(1)
        .maybeSingle();
      const { data: cp } = await supabaseAdmin.from('creator_profiles').select('payout_methods').eq('user_id', e.creator_id).single();
      const pm = (cp?.payout_methods ?? {}) as { selected?: string; methods?: Record<string, Record<string, string>> };
      const sel = pm.selected;
      const det = sel ? pm.methods?.[sel] : undefined;
      let shown = det ? { ...det } : undefined;
      if (shown?.account_number_enc) {
        try {
          shown.account_number = decryptField(shown.account_number_enc);
        } catch {
          shown.account_number = '[decrypt failed — check PAYOUT_ENCRYPTION_KEY]';
        }
        delete shown.account_number_enc;
        delete shown.account_number_last4;
      }
      const label = sel === 'cash'
        ? 'Cash pickup — partner location (pickup mechanics TBD)'
        : sel && shown
          ? `${sel}: ${Object.entries(shown).map(([k, v]) => k + '=' + v).join(', ')}`
          : null;
      requests.push({
        ...e,
        name: prof?.full_name,
        email: prof?.email,
        // Cash pickup is arranged by PHONE (WhatsApp/call) — manual by
        // design; the number is the admin's contact path.
        phone: prof?.phone ?? null,
        method: sel ?? null,
        admin_note: (alert?.detail as { admin_note?: string } | null)?.admin_note ?? null,
        payout_details: label,
      });
    }
    return { requests };
  });
  // Free-text note on a payout request ("Arranged Thurs 2pm, ID confirmed")
  // — stored on the request alert, audited like everything else.
  app.post<{ Body: { creator_id?: string; note?: string } }>(
    '/v1/admin/payout-requests/note',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const { creator_id, note } = request.body ?? {};
      if (!creator_id || !note?.trim()) return reply.code(400).send({ error: 'creator_id and note required' });
      const { data: alert } = await supabaseAdmin
        .from('admin_alerts')
        .select('id, detail')
        .eq('alert_type', 'payout_requested')
        .is('resolved_at', null)
        .filter('detail->>creator_id', 'eq', creator_id)
        .limit(1)
        .maybeSingle();
      if (!alert) return reply.code(404).send({ error: 'No open payout request for this creator' });
      await supabaseAdmin
        .from('admin_alerts')
        .update({ detail: { ...(alert.detail as object), admin_note: note.trim() } })
        .eq('id', alert.id);
      await audit(adminId, 'payout_note', creator_id, { note: note.trim() });
      return { noted: true };
    },
  );

  app.post<{ Body: { creator_id?: string } }>('/v1/admin/payout-requests/fulfill', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const creatorId = request.body?.creator_id;
    if (!creatorId) return reply.code(400).send({ error: 'creator_id required' });
    const { data: rows } = await supabaseAdmin
      .from('creator_payouts')
      .select('id, amount_usd')
      .eq('creator_id', creatorId)
      .eq('status', 'requested');
    if (!rows?.length) return reply.code(409).send({ error: 'No requested payouts for this creator' });
    const total = Math.round(rows.reduce((s, r) => s + Number(r.amount_usd), 0) * 100) / 100;
    await supabaseAdmin
      .from('creator_payouts')
      .update({ status: 'paid_out', paid_out_at: new Date().toISOString() })
      .in('id', rows.map((r) => r.id));
    await supabaseAdmin
      .from('admin_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('alert_type', 'payout_requested')
      .is('resolved_at', null)
      .filter('detail->>creator_id', 'eq', creatorId);
    await audit(adminId, 'payout_fulfilled', creatorId, { amount_usd: total, payout_ids: rows.map((r) => r.id) });
    await notify(creatorId, 'payout_paid', 'Payout sent', `$${total.toFixed(2)} has been sent to your payout method.`);
    return { fulfilled: true, amount_usd: total };
  });

  // Admin login: normal Supabase password auth; membership checked on use.
  // Ops check: verify outbound email (Resend) is actually configured and
  // sending. Returns the Resend message id, or simulated:true when no key.
  app.post<{ Body: { to?: string } }>('/v1/admin/test-email', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const to = request.body?.to?.trim();
    if (!to || !to.includes('@')) return reply.code(400).send({ error: 'to (email) is required' });
    const result = await sendEmail(
      to,
      'Snapt outbound email test',
      '<p>This is a test of Snapt server email delivery. If you can read this, Resend is live.</p>',
    );
    await audit(adminId, 'test_email', to, { ...result });
    return result;
  });

  app.post<{ Body: { email?: string; password?: string } }>('/v1/admin/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) return reply.code(400).send({ error: 'email and password required' });
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const json = (await res.json()) as { access_token?: string; user?: { id: string } };
    if (!res.ok || !json.access_token || !json.user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const { data } = await supabaseAdmin.from('admin_users').select('user_id, role').eq('user_id', json.user.id).maybeSingle();
    if (!data) return reply.code(403).send({ error: 'Not an admin account' });
    return { access_token: json.access_token, role: data.role };
  });

  // Responsive single-page portal on the same origin.
  app.get('/admin', async (_request, reply) => {
    reply.type('text/html').send(ADMIN_HTML);
  });
}

const ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snapt Admin</title><style>
body{font-family:system-ui;margin:0;background:#FAFAFA;color:#1A1A1A}
header{background:#1A1A1A;color:#FFB800;padding:14px 20px;font-weight:800;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header input{border:none;border-radius:8px;padding:8px 10px;min-width:220px}
main{padding:16px;max-width:900px;margin:0 auto}
h2{font-size:15px;margin:22px 0 8px}
.card{background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.07);font-size:13px}
.sos{border-left:5px solid #EB5757}
.tag{display:inline-block;background:#FFF4D6;color:#8A6800;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;margin-right:8px}
button{background:#FFB800;border:none;border-radius:8px;padding:7px 12px;font-weight:700;cursor:pointer;margin:4px 4px 0 0}
button.ghost{background:#eee}
pre{white-space:pre-wrap;font-size:11px;color:#555;margin:6px 0 0}
</style></head><body>
<header>Snapt Admin
<input id="em" placeholder="Admin email" />
<input id="pw" placeholder="Password" type="password" />
<button onclick="login()">Sign in</button></header>
<main>
<div id="stats" style="display:flex;gap:8px;flex-wrap:wrap"></div>
<h2>Fee & config settings</h2><div id="cfg"></div>
<h2>Manual dispatch — unassigned bookings</h2><div id="unassigned"></div>
<h2>Alerts (SOS first)</h2><div id="alerts"></div>
<h2>Open disputes</h2><div id="disputes"></div>
<h2>Creator applications</h2><div id="apps"></div>
<h2>Legal & policy documents</h2><div id="pol"></div>
<h2>Pending payouts (manual fulfillment)</h2><div id="payouts"></div>
<h2>Moderation queue (severity first)</h2><div id="mod"></div>
</main><script>
const $=id=>document.getElementById(id);
const H=()=>({'Authorization':'Bearer '+(localStorage.jwt||''),'x-admin-token':localStorage.tok||'','Content-Type':'application/json'});
async function login(){const r=await fetch('/v1/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('em').value,password:$('pw').value})});const d=await r.json();if(d.access_token){localStorage.jwt=d.access_token;load()}else alert(d.error||'Login failed')}
async function j(u,o){const r=await fetch(u,Object.assign({headers:H()},o));return r.json()}
async function load(){
 const st=await j('/v1/admin/analytics');
 if(st.bookings){$('stats').innerHTML=[['Pending',st.bookings.pending],['Confirmed',st.bookings.confirmed],['Completed',st.bookings.completed],['Disputed',st.bookings.disputed],['GMV $',st.money.charged_usd],['Refunded $',st.money.refunded_usd],['Creators',st.creators.approved],['Open disputes',st.open_disputes],['Active strikes',st.active_strikes]].map(x=>'<div class="card" style="flex:1;min-width:90px;text-align:center"><div style="font-size:20px;font-weight:800">'+x[1]+'</div><div style="font-size:11px;color:#777">'+x[0]+'</div></div>').join('')}
 const cfg=await j('/v1/admin/config');
 $('cfg').innerHTML=(cfg.config||[]).map(c=>'<div class="card"><b>'+c.key+'</b> '+(c.confirmed?'':'<span class="tag">UNCONFIRMED</span>')+'<pre>'+c.description+'</pre><input style="width:70%" id="v-'+c.key+'" value=\''+JSON.stringify(c.value).replace(/'/g,"&#39;")+'\'/> <button onclick="saveCfg(\''+c.key+'\')">Save</button></div>').join('');
 loadPolicies();loadPayouts();loadMod();
 const un=await j('/v1/admin/unassigned');
 $('unassigned').innerHTML=(un.bookings||[]).map(b=>'<div class="card"><span class="tag">'+(b.occasion||b.type)+'</span>'+(b.area||'')+' · '+(b.scheduled_at?new Date(b.scheduled_at).toLocaleString():'remote')+'<br/><input placeholder="creator uuid" id="a-'+b.id+'" style="width:60%"/> <button onclick="assign(\''+b.id+'\')">Assign</button></div>').join('')||'<div class="card">Nothing waiting for dispatch.</div>';
 const a=await j('/v1/admin/alerts');
 $('alerts').innerHTML=(a.alerts||[]).map(x=>'<div class="card '+(x.alert_type==='sos'?'sos':'')+'"><span class="tag">'+x.alert_type+'</span>'+new Date(x.created_at).toLocaleString()+'<pre>'+JSON.stringify(x.detail)+'</pre><button onclick="resolveAlert(\\''+x.id+'\\')">Resolve</button></div>').join('')||'<div class="card">Queue clear.</div>';
 const d=await j('/v1/admin/disputes');
 $('disputes').innerHTML=(d.disputes||[]).map(x=>'<div class="card"><span class="tag">'+x.category+'</span>'+x.status+' · opened '+new Date(x.created_at).toLocaleString()+'<pre>'+(x.description||'')+'</pre><pre>Evidence: '+(x.dispute_evidence||[]).length+' item(s)</pre><button onclick="resolveDispute(\\''+x.id+'\\',true)">Resolve — release payout</button><button class="ghost" onclick="resolveDispute(\\''+x.id+'\\',false)">Resolve — withhold</button></div>').join('')||'<div class="card">No open disputes.</div>';
 const p=await j('/v1/admin/applications');
 $('apps').innerHTML=(p.applications||[]).map(x=>'<div class="card"><b>'+x.profiles.full_name+'</b> · '+x.profiles.email+'<pre>'+(x.specialties||[]).join(', ')+' · '+(x.base_area||'')+'</pre><button onclick="approve(\\''+x.user_id+'\\')">Approve (bg check passed)</button></div>').join('')||'<div class="card">No pending applications.</div>';
}
async function loadMod(){const m=await j('/v1/admin/moderation');
 $('mod').innerHTML=((m.reports||[]).map(r=>'<div class="card '+(r.severity==='critical'?'sos':'')+'"><span class="tag">'+r.severity.toUpperCase()+'</span><span class="tag">'+r.category+'</span>reporter '+r.reporter_id.slice(0,8)+(r.reporter_false_report_count?' <span class="tag" style="background:#B4442E;color:#fff">⚠ '+r.reporter_false_report_count+' overturned report'+(r.reporter_false_report_count>1?'s':'')+'</span>':'')+' → target '+(r.target_user_id||'n/a').slice(0,8)+(r.law_enforcement_referral?' <span class="tag">LE REFERRAL</span>':'')+'<pre>'+(r.details||'')+'</pre>'+(r.target_user_id?'<button class="ghost" onclick="unsuspend(\''+r.target_user_id+'\')">Unsuspend target</button>':'')+'<button onclick="modAct(\''+r.id+'\',\'actioned\')">Action taken</button><button class="ghost" onclick="modAct(\''+r.id+'\',\'dismissed\')">Dismiss</button> <select id="sv-'+r.id+'"><option>critical</option><option>high</option><option>medium</option><option>low</option></select><button class="ghost" onclick="modTier(\''+r.id+'\')">Set tier</button></div>').join(''))+((m.portfolio_pending||[]).map(p=>'<div class="card"><span class="tag">PORTFOLIO</span>'+p.creator_id.slice(0,8)+'<pre>'+(p.caption||'')+'</pre><button onclick="pf(\''+p.id+'\',\'approved\')">Approve</button><button class="ghost" onclick="pf(\''+p.id+'\',\'rejected\')">Reject</button></div>').join(''))||'<div class="card">Moderation queue clear.</div>'}
async function unsuspend(uid){const reason=prompt('Reason for lifting suspension (required):');if(!reason)return;await j('/v1/admin/users/'+uid+'/unsuspend',{method:'POST',body:JSON.stringify({reason})});loadMod()}
async function modAct(id,a){await j('/v1/admin/reports/'+id,{method:'POST',body:JSON.stringify({action:a})});loadMod()}
async function modTier(id){await j('/v1/admin/reports/'+id,{method:'POST',body:JSON.stringify({severity:$('sv-'+id).value})});loadMod()}
async function pf(id,d){await j('/v1/admin/portfolio/'+id,{method:'POST',body:JSON.stringify({decision:d})});loadMod()}
async function loadPayouts(){const p=await j('/v1/admin/payout-requests');$('payouts').innerHTML=(p.requests||[]).map(r=>'<div class="card"><b>'+(r.name||r.creator_id)+'</b> · $'+r.total.toFixed(2)+(r.method==='cash'?' <span class="tag">CASH PICKUP</span>':'')+'<div style="font-size:15px;font-weight:800;margin:6px 0">📞 '+(r.phone||'⚠ no phone on file')+'</div><pre>'+(r.payout_details||'⚠ NO PAYOUT DETAILS ON FILE — contact creator')+'</pre>'+(r.admin_note?'<pre>📝 '+r.admin_note+'</pre>':'')+'<input id="pn-'+r.creator_id+'" placeholder="Note (e.g. Arranged Thurs 2pm, ID confirmed)" style="width:70%"/> <button class="ghost" onclick="pNote(\''+r.creator_id+'\')">Save note</button><br/><button onclick="fulfill(\''+r.creator_id+'\')">Mark paid out</button></div>').join('')||'<div class="card">No pending payout requests.</div>'}
async function pNote(cid){const n=$('pn-'+cid).value;if(!n)return;await j('/v1/admin/payout-requests/note',{method:'POST',body:JSON.stringify({creator_id:cid,note:n})});loadPayouts()}
async function fulfill(cid){await j('/v1/admin/payout-requests/fulfill',{method:'POST',body:JSON.stringify({creator_id:cid})});loadPayouts()}
async function loadPolicies(){const p=await j('/v1/admin/policies');const latest={};(p.policies||[]).forEach(x=>{if(!latest[x.doc_type])latest[x.doc_type]=x});$('pol').innerHTML=Object.values(latest).map(x=>'<div class="card"><b>'+x.doc_type+'</b> v'+x.version+' <span class="tag">'+x.status.toUpperCase()+'</span>'+(x.requires_reconsent?'<span class="tag">RE-CONSENT</span>':'')+(x.published_at?' published '+new Date(x.published_at).toLocaleDateString():'')+'<br/><textarea id="pc-'+x.doc_type+'" rows="3" style="width:98%" placeholder="New version content…"></textarea><br/><label style="font-size:11px"><input type="checkbox" id="pr-'+x.doc_type+'"/> material change (forces re-consent)</label><br/><button onclick="draftPolicy(\''+x.doc_type+'\')">Save as draft v'+(x.version+1)+'</button>'+(x.status==='draft'?'<button class="ghost" onclick="publishPolicy(\''+x.id+'\')">Publish v'+x.version+'</button>':'')+'</div>').join('')}
async function draftPolicy(slug){const c=$('pc-'+slug).value;if(!c)return alert('Content required');await j('/v1/admin/policies/'+slug,{method:'POST',body:JSON.stringify({content:c,requires_reconsent:$('pr-'+slug).checked})});loadPolicies()}
async function publishPolicy(id){await j('/v1/admin/policies/'+id+'/publish',{method:'POST'});loadPolicies()}
async function saveCfg(k){try{const v=JSON.parse($('v-'+k).value);await j('/v1/admin/config/'+k,{method:'PUT',body:JSON.stringify({value:v})});load()}catch(e){alert('Invalid JSON')}}
async function assign(id){await j('/v1/admin/bookings/'+id+'/assign',{method:'POST',body:JSON.stringify({creator_id:$('a-'+id).value.trim()})});load()}
async function resolveAlert(id){await j('/v1/admin/alerts/'+id+'/resolve',{method:'POST'});load()}
async function resolveDispute(id,rel){const note=prompt('Resolution note:')||'';await j('/v1/admin/disputes/'+id+'/resolve',{method:'POST',body:JSON.stringify({resolution:note,release_payout:rel})});load()}
async function approve(id){await j('/v1/admin/creators/'+id+'/approve',{method:'POST',body:JSON.stringify({background_check_passed:true})});load()}
if(localStorage.jwt||localStorage.tok)load();
</script></body></html>`;
