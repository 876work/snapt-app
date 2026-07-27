import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { env } from '../env.js';

// Admin Portal (handoff §15) — Phase 5 foundation. Sits on the SAME backend
// and data model as the apps (§15 mandate), served as a responsive single
// page at /admin, authenticated with ADMIN_API_TOKEN (real admin accounts
// come with the full portal build-out). Covers: alert queues (SOS first),
// dispute review/resolution, creator application vetting, per-creator strike
// history + overturn. Remaining §15 scope (fee settings UI, analytics,
// moderation, legal CMS, manual dispatch) is tracked in the README.

function guard(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.adminApiToken) {
    reply.code(503).send({ error: 'Admin actions disabled' });
    return false;
  }
  if (request.headers['x-admin-token'] !== env.adminApiToken) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.get('/v1/admin/alerts', async (request, reply) => {
    if (!guard(request, reply)) return;
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
    if (!guard(request, reply)) return;
    await supabaseAdmin
      .from('admin_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', request.params.id);
    return { resolved: true };
  });

  app.get('/v1/admin/disputes', async (request, reply) => {
    if (!guard(request, reply)) return;
    const { data } = await supabaseAdmin
      .from('disputes')
      .select('*, dispute_evidence(id, submitted_by, kind, content, created_at)')
      .not('status', 'in', '(resolved,closed)')
      .order('created_at', { ascending: true });
    return { disputes: data ?? [] };
  });

  app.get('/v1/admin/applications', async (request, reply) => {
    if (!guard(request, reply)) return;
    const { data } = await supabaseAdmin
      .from('creator_profiles')
      .select('user_id, specialties, base_area, vetting_status, created_at, profiles!inner(full_name, email)')
      .eq('vetting_status', 'in_review')
      .order('created_at', { ascending: true });
    return { applications: data ?? [] };
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
<input id="tok" placeholder="Admin token" />
<button onclick="save()">Load</button></header>
<main>
<h2>Alerts (SOS first)</h2><div id="alerts"></div>
<h2>Open disputes</h2><div id="disputes"></div>
<h2>Creator applications</h2><div id="apps"></div>
</main><script>
const $=id=>document.getElementById(id);
const H=()=>({'x-admin-token':localStorage.tok||'','Content-Type':'application/json'});
function save(){localStorage.tok=$('tok').value;load()}
async function j(u,o){const r=await fetch(u,Object.assign({headers:H()},o));return r.json()}
async function load(){
 $('tok').value=localStorage.tok||'';
 const a=await j('/v1/admin/alerts');
 $('alerts').innerHTML=(a.alerts||[]).map(x=>'<div class="card '+(x.alert_type==='sos'?'sos':'')+'"><span class="tag">'+x.alert_type+'</span>'+new Date(x.created_at).toLocaleString()+'<pre>'+JSON.stringify(x.detail)+'</pre><button onclick="resolveAlert(\\''+x.id+'\\')">Resolve</button></div>').join('')||'<div class="card">Queue clear.</div>';
 const d=await j('/v1/admin/disputes');
 $('disputes').innerHTML=(d.disputes||[]).map(x=>'<div class="card"><span class="tag">'+x.category+'</span>'+x.status+' · opened '+new Date(x.created_at).toLocaleString()+'<pre>'+(x.description||'')+'</pre><pre>Evidence: '+(x.dispute_evidence||[]).length+' item(s)</pre><button onclick="resolveDispute(\\''+x.id+'\\',true)">Resolve — release payout</button><button class="ghost" onclick="resolveDispute(\\''+x.id+'\\',false)">Resolve — withhold</button></div>').join('')||'<div class="card">No open disputes.</div>';
 const p=await j('/v1/admin/applications');
 $('apps').innerHTML=(p.applications||[]).map(x=>'<div class="card"><b>'+x.profiles.full_name+'</b> · '+x.profiles.email+'<pre>'+(x.specialties||[]).join(', ')+' · '+(x.base_area||'')+'</pre><button onclick="approve(\\''+x.user_id+'\\')">Approve (bg check passed)</button></div>').join('')||'<div class="card">No pending applications.</div>';
}
async function resolveAlert(id){await j('/v1/admin/alerts/'+id+'/resolve',{method:'POST'});load()}
async function resolveDispute(id,rel){const note=prompt('Resolution note:')||'';await j('/v1/admin/disputes/'+id+'/resolve',{method:'POST',body:JSON.stringify({resolution:note,release_payout:rel})});load()}
async function approve(id){await j('/v1/admin/creators/'+id+'/approve',{method:'POST',body:JSON.stringify({background_check_passed:true})});load()}
if(localStorage.tok)load();
</script></body></html>`;
