import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin, type AdminRole } from '../admin-auth.js';
import { sendEmail } from '../email.js';
import { env } from '../env.js';

// Portal team management + manual user creation + internal notes + email
// resends + CSV exports (admin portal phase 2).
//
// Access-control invariants (enforced HERE, server-side, not in the UI):
//  - Team endpoints are admin-role only.
//  - Passwords are never set by an admin: invitees get a single-use,
//    expiring set-password link over Resend.
//  - No self-deactivation or self-demotion.
//  - The system can never reach zero active admins.
//  - Deactivation bites immediately (requireAdmin re-checks `active` on
//    every request).
// Deactivation is SOFT only: admin_actions must keep attributing history,
// so accounts are never deleted.

const INVITE_TTL_HOURS = 72;
const ROLES: AdminRole[] = ['admin', 'support', 'moderator'];

function inviteEmailHtml(kind: 'portal' | 'app', name: string, link: string): string {
  const head = `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="width:40px;height:40px;border-radius:11px;background:#FFB800;color:#1A1A1A;font-weight:800;font-size:20px;text-align:center;line-height:40px">S</div>
    <h2 style="color:#1A1A1A;margin:18px 0 6px">`;
  const foot = `<p style="color:#6f6f6f;font-size:13px">This link is single-use and expires in ${INVITE_TTL_HOURS} hours. If it wasn't meant for you, ignore this email.</p></div>`;
  if (kind === 'portal') {
    return `${head}You've been given Snapt admin access</h2>
      <p style="color:#4a4a4a">Hi ${name || 'there'} — an administrator added you to the Snapt admin portal. Set your password to get started:</p>
      <p><a href="${link}" style="display:inline-block;background:#FFB800;color:#1A1A1A;font-weight:700;padding:12px 22px;border-radius:11px;text-decoration:none">Set my password</a></p>
      <p style="color:#4a4a4a;font-size:13px">Then sign in at <a href="${env.portalBaseUrl}/admin">${env.portalBaseUrl}/admin</a>.</p>${foot}`;
  }
  return `${head}Welcome to Snapt</h2>
    <p style="color:#4a4a4a">Hi ${name || 'there'} — your Snapt account has been set up for you. Choose a password, then sign in from the Snapt app:</p>
    <p><a href="${link}" style="display:inline-block;background:#FFB800;color:#1A1A1A;font-weight:700;padding:12px 22px;border-radius:11px;text-decoration:none">Set my password</a></p>${foot}`;
}

async function createInvite(userId: string, kind: 'portal' | 'app', createdBy: string | null): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await supabaseAdmin.from('admin_invites').insert({
    token,
    user_id: userId,
    kind,
    created_by: createdBy,
    expires_at: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000).toISOString(),
  });
  return `${env.portalBaseUrl}/admin/set-password?token=${token}`;
}

async function activeAdminCountExcluding(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('admin_users')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('active', true)
    .neq('user_id', userId);
  return count ?? 0;
}

export function registerAdminTeamRoutes(app: FastifyInstance) {
  // ---- Team ---------------------------------------------------------------

  app.get('/v1/admin/team', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin']);
    if (!admin) return;
    const { data: members, error } = await supabaseAdmin
      .from('admin_users')
      .select('user_id, role, active, created_at, added_by')
      .order('created_at', { ascending: true });
    if (error) return reply.code(500).send({ error: error.message });
    const rows = [];
    for (const m of members ?? []) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', m.user_id)
        .maybeSingle();
      // last sign-in lives in auth; a few members, so per-row lookups are fine.
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      rows.push({
        ...m,
        name: prof?.full_name ?? '',
        email: prof?.email ?? authUser?.user?.email ?? null,
        last_sign_in_at: authUser?.user?.last_sign_in_at ?? null,
      });
    }
    return { members: rows };
  });

  app.post<{ Body: { email?: string; name?: string; role?: string } }>(
    '/v1/admin/team',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      const email = request.body?.email?.trim().toLowerCase();
      const name = request.body?.name?.trim() ?? '';
      const role = request.body?.role as AdminRole;
      if (!email || !/.+@.+\..+/.test(email)) return reply.code(400).send({ error: 'A valid email is required' });
      if (!ROLES.includes(role)) return reply.code(400).send({ error: `role must be one of ${ROLES.join(', ')}` });

      // Reuse an existing auth user (e.g. promoting an app user); otherwise
      // create one with no usable password — the invite link sets it.
      let userId: string | null = null;
      let existing = false;
      const { data: prof } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
      if (prof) {
        userId = prof.id;
        existing = true;
      } else {
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: name },
        });
        if (error || !created.user) return reply.code(500).send({ error: error?.message ?? 'Could not create user' });
        userId = created.user.id;
        if (name) await supabaseAdmin.from('profiles').update({ full_name: name }).eq('id', userId);
      }

      const { error: insErr } = await supabaseAdmin
        .from('admin_users')
        .insert({ user_id: userId, role, added_by: admin.id === 'bootstrap-token' ? null : admin.id });
      if (insErr) {
        return reply.code(insErr.code === '23505' ? 409 : 500).send({
          error: insErr.code === '23505' ? 'That person already has a portal account' : insErr.message,
        });
      }

      // Existing users keep their password; new ones get the set-password link.
      if (existing) {
        await sendEmail(
          email,
          'You now have Snapt admin portal access',
          `<p>Hi ${name || 'there'} — you've been given <b>${role}</b> access to the Snapt admin portal. Sign in with your existing Snapt password at <a href="${env.portalBaseUrl}/admin">${env.portalBaseUrl}/admin</a>.</p>`,
        );
      } else {
        const link = await createInvite(userId!, 'portal', admin.id === 'bootstrap-token' ? null : admin.id);
        await sendEmail(email, 'Your Snapt admin portal invite', inviteEmailHtml('portal', name, link));
      }
      await audit(admin, 'team_member_added', userId!, { email, role, existing_user: existing });
      return reply.code(201).send({ user_id: userId, invited: !existing });
    },
  );

  app.put<{ Params: { userId: string }; Body: { role?: string } }>(
    '/v1/admin/team/:userId',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      const role = request.body?.role as AdminRole;
      if (!ROLES.includes(role)) return reply.code(400).send({ error: `role must be one of ${ROLES.join(', ')}` });
      if (request.params.userId === admin.id) {
        return reply.code(400).send({ error: 'You cannot change your own role — ask another admin' });
      }
      const { data: target } = await supabaseAdmin
        .from('admin_users')
        .select('role, active')
        .eq('user_id', request.params.userId)
        .maybeSingle();
      if (!target) return reply.code(404).send({ error: 'No such portal account' });
      if (target.role === 'admin' && role !== 'admin' && target.active) {
        if ((await activeAdminCountExcluding(request.params.userId)) === 0) {
          return reply.code(409).send({ error: 'That would leave the portal with no active admin' });
        }
      }
      await supabaseAdmin.from('admin_users').update({ role }).eq('user_id', request.params.userId);
      await audit(admin, 'team_role_changed', request.params.userId, { from: target.role, to: role });
      return { updated: true };
    },
  );

  app.post<{ Params: { userId: string } }>('/v1/admin/team/:userId/deactivate', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin']);
    if (!admin) return;
    if (request.params.userId === admin.id) {
      return reply.code(400).send({ error: 'You cannot deactivate your own account — ask another admin' });
    }
    const { data: target } = await supabaseAdmin
      .from('admin_users')
      .select('role, active')
      .eq('user_id', request.params.userId)
      .maybeSingle();
    if (!target) return reply.code(404).send({ error: 'No such portal account' });
    if (!target.active) return reply.code(409).send({ error: 'Already deactivated' });
    if (target.role === 'admin' && (await activeAdminCountExcluding(request.params.userId)) === 0) {
      return reply.code(409).send({ error: 'That would leave the portal with no active admin' });
    }
    await supabaseAdmin.from('admin_users').update({ active: false }).eq('user_id', request.params.userId);
    await audit(admin, 'team_member_deactivated', request.params.userId);
    return { deactivated: true };
  });

  app.post<{ Params: { userId: string } }>('/v1/admin/team/:userId/reactivate', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin']);
    if (!admin) return;
    const { data: target } = await supabaseAdmin
      .from('admin_users')
      .select('active')
      .eq('user_id', request.params.userId)
      .maybeSingle();
    if (!target) return reply.code(404).send({ error: 'No such portal account' });
    if (target.active) return reply.code(409).send({ error: 'Already active' });
    await supabaseAdmin.from('admin_users').update({ active: true }).eq('user_id', request.params.userId);
    await audit(admin, 'team_member_reactivated', request.params.userId);
    return { reactivated: true };
  });

  // Invite redemption — the ONLY unauthenticated route here. The token is
  // the credential: single-use, expiring, unguessable (24 random bytes).
  app.post<{ Body: { token?: string; password?: string } }>(
    '/v1/admin/set-password',
    async (request, reply) => {
      const { token, password } = request.body ?? {};
      if (!token) return reply.code(400).send({ error: 'token required' });
      if (!password || password.length < 10) {
        return reply.code(400).send({ error: 'Password must be at least 10 characters' });
      }
      const { data: invite } = await supabaseAdmin
        .from('admin_invites')
        .select('token, user_id, kind, expires_at, used_at')
        .eq('token', token)
        .maybeSingle();
      if (!invite) return reply.code(404).send({ error: 'This link is not valid' });
      if (invite.used_at) return reply.code(409).send({ error: 'This link was already used' });
      if (Date.parse(invite.expires_at) < Date.now()) {
        return reply.code(410).send({ error: 'This link has expired — ask for a new invite' });
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(invite.user_id, { password });
      if (error) return reply.code(500).send({ error: error.message });
      await supabaseAdmin.from('admin_invites').update({ used_at: new Date().toISOString() }).eq('token', token);
      await audit(invite.user_id, 'password_set_via_invite', invite.user_id, { kind: invite.kind });
      return { set: true, kind: invite.kind };
    },
  );

  // ---- Manual app-user creation ------------------------------------------

  app.post<{ Body: { email?: string; full_name?: string; phone?: string } }>(
    '/v1/admin/users',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      const email = request.body?.email?.trim().toLowerCase();
      const full_name = request.body?.full_name?.trim() ?? '';
      const phone = request.body?.phone?.trim() || null;
      if (!email || !/.+@.+\..+/.test(email)) return reply.code(400).send({ error: 'A valid email is required' });
      const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
      if (existing) return reply.code(409).send({ error: 'An account with that email already exists' });
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (error || !created.user) return reply.code(500).send({ error: error?.message ?? 'Could not create user' });
      await supabaseAdmin.from('profiles').update({ full_name, phone }).eq('id', created.user.id);
      const link = await createInvite(created.user.id, 'app', admin.id === 'bootstrap-token' ? null : admin.id);
      await sendEmail(email, 'Welcome to Snapt — set your password', inviteEmailHtml('app', full_name, link));
      await audit(admin, 'user_created_manually', created.user.id, { email });
      return reply.code(201).send({ user_id: created.user.id });
    },
  );

  // Re-send a set-password link to any app user ("I never got the email" /
  // phone-support password resets).
  app.post<{ Params: { id: string } }>('/v1/admin/users/:id/send-password-link', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', request.params.id)
      .maybeSingle();
    if (!prof?.email) return reply.code(404).send({ error: 'No such user (or no email on file)' });
    const link = await createInvite(prof.id, 'app', admin.id === 'bootstrap-token' ? null : admin.id);
    await sendEmail(prof.email, 'Reset your Snapt password', inviteEmailHtml('app', prof.full_name, link));
    await audit(admin, 'password_link_sent', prof.id);
    return { sent: true };
  });

  // The clean creator hand-off: create/keep the user account, nudge them to
  // apply in-app — the application flow owns consents and vetting.
  app.post<{ Params: { id: string } }>('/v1/admin/users/:id/nudge-apply', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', request.params.id)
      .maybeSingle();
    if (!prof?.email) return reply.code(404).send({ error: 'No such user (or no email on file)' });
    await sendEmail(
      prof.email,
      'Become a Snapt creator',
      `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <div style="width:40px;height:40px;border-radius:11px;background:#FFB800;color:#1A1A1A;font-weight:800;font-size:20px;text-align:center;line-height:40px">S</div>
        <h2 style="color:#1A1A1A;margin:18px 0 6px">Ready to earn with your camera?</h2>
        <p style="color:#4a4a4a">Hi ${prof.full_name || 'there'} — as discussed, the next step is the creator application inside the Snapt app: open <b>Profile → Become a Creator</b>. It takes about ten minutes — your specialties, your service area, and the creator agreement.</p>
        <p style="color:#4a4a4a">Once you apply, our team reviews it and you'll hear back by email.</p>
      </div>`,
    );
    await audit(admin, 'nudge_apply_sent', prof.id);
    return { sent: true };
  });

  // ---- Internal notes -----------------------------------------------------
  // Attributed, timestamped, admin-side only — no client endpoint reads these.

  app.get<{ Querystring: { subject_type?: string; subject_id?: string } }>(
    '/v1/admin/notes',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const { subject_type, subject_id } = request.query;
      if (!subject_type || !subject_id) return reply.code(400).send({ error: 'subject_type and subject_id required' });
      const { data, error } = await supabaseAdmin
        .from('admin_notes')
        .select('*')
        .eq('subject_type', subject_type)
        .eq('subject_id', subject_id)
        .order('created_at', { ascending: false });
      if (error) return reply.code(500).send({ error: error.message });
      const adminIds = [...new Set((data ?? []).map((n) => n.admin_id))];
      const nameOf = new Map<string, string>();
      if (adminIds.length) {
        const { data: profs } = await supabaseAdmin.from('profiles').select('id, full_name').in('id', adminIds);
        for (const p of profs ?? []) nameOf.set(p.id, p.full_name);
      }
      return { notes: (data ?? []).map((n) => ({ ...n, admin_name: nameOf.get(n.admin_id) ?? 'admin' })) };
    },
  );

  app.post<{ Body: { subject_type?: string; subject_id?: string; body?: string } }>(
    '/v1/admin/notes',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const { subject_type, subject_id, body } = request.body ?? {};
      if (!subject_type || !['user', 'booking', 'creator'].includes(subject_type) || !subject_id || !body?.trim()) {
        return reply.code(400).send({ error: 'subject_type (user|booking|creator), subject_id, and body required' });
      }
      const { data, error } = await supabaseAdmin
        .from('admin_notes')
        .insert({
          subject_type,
          subject_id,
          body: body.trim(),
          admin_id: admin.id === 'bootstrap-token' ? '00000000-0000-4000-8000-00000000000a' : admin.id,
        })
        .select()
        .single();
      if (error) return reply.code(500).send({ error: error.message });
      return reply.code(201).send({ note: data });
    },
  );

  // ---- Resend transactional emails ---------------------------------------
  // Reconstructs the canonical email for a record and re-sends it (email
  // only — no duplicate push/in-app). One of support's most-used buttons.

  app.post<{ Body: { kind?: string; booking_id?: string; user_id?: string } }>(
    '/v1/admin/resend-email',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const { kind, booking_id, user_id } = request.body ?? {};

      const profileOf = async (id: string) => {
        const { data } = await supabaseAdmin.from('profiles').select('id, full_name, email').eq('id', id).maybeSingle();
        return data;
      };

      let to: string | null = null;
      let subject = '';
      let html = '';

      if (kind === 'booking_confirmation' || kind === 'refund_notice') {
        if (!booking_id) return reply.code(400).send({ error: 'booking_id required' });
        const { data: b } = await supabaseAdmin
          .from('bookings')
          .select('id, client_id, occasion, type, area, scheduled_at, price_usd, status')
          .eq('id', booking_id)
          .maybeSingle();
        if (!b) return reply.code(404).send({ error: 'No such booking' });
        const client = await profileOf(b.client_id);
        if (!client?.email) return reply.code(409).send({ error: 'Client has no email on file' });
        to = client.email;
        if (kind === 'booking_confirmation') {
          subject = 'Your Snapt booking is confirmed';
          html = `<p>Hi ${client.full_name || 'there'} — your ${b.occasion ?? 'session'} booking is confirmed.</p>
            <p>${b.type === 'remote' ? 'Remote session' : `Meeting near ${b.area ?? 'your chosen spot'}`}${
              b.scheduled_at ? ` · ${new Date(b.scheduled_at).toLocaleString()}` : ''
            } · $${Number(b.price_usd).toFixed(2)} USD</p>
            <p>Booking reference: ${b.id}</p>`;
        } else {
          const { data: refund } = await supabaseAdmin
            .from('transactions')
            .select('amount_usd, created_at')
            .eq('booking_id', booking_id)
            .eq('type', 'refund')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!refund) return reply.code(409).send({ error: 'No refund recorded on this booking' });
          subject = 'Your Snapt refund';
          html = `<p>Hi ${client.full_name || 'there'} — a refund of $${Number(refund.amount_usd).toFixed(2)} USD was processed on ${new Date(refund.created_at).toLocaleDateString()} for booking ${b.id}.</p>
            <p>Refunds appear on your statement within 5–10 business days.</p>`;
        }
      } else if (kind === 'payout_notification') {
        if (!user_id) return reply.code(400).send({ error: 'user_id required' });
        const creator = await profileOf(user_id);
        if (!creator?.email) return reply.code(409).send({ error: 'Creator has no email on file' });
        const { data: paid } = await supabaseAdmin
          .from('creator_payouts')
          .select('amount_usd, paid_out_at')
          .eq('creator_id', user_id)
          .eq('status', 'paid_out')
          .order('paid_out_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!paid) return reply.code(409).send({ error: 'No paid-out payout for this creator' });
        const total = Number(paid.amount_usd).toFixed(2);
        to = creator.email;
        subject = 'Payout sent';
        html = `<p>Hi ${creator.full_name || 'there'} — $${total} USD was sent to your payout method on ${new Date(paid.paid_out_at!).toLocaleDateString()}.</p>`;
      } else {
        return reply.code(400).send({ error: 'kind must be booking_confirmation, refund_notice, or payout_notification' });
      }

      const result = await sendEmail(to!, subject, html);
      if (!result.sent) return reply.code(502).send({ error: 'Resend rejected the email' });
      await audit(admin, 'email_resent', booking_id ?? user_id ?? '', { kind, to, simulated: result.simulated });
      return { sent: true, simulated: result.simulated };
    },
  );

  // ---- CSV exports (accounting) ------------------------------------------

  const csv = (rows: Record<string, unknown>[], columns: string[]): string => {
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  };

  app.get<{ Params: { kind: string }; Querystring: { from?: string; to?: string } }>(
    '/v1/admin/export/:kind',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const from = request.query.from ? new Date(request.query.from).toISOString() : '1970-01-01T00:00:00Z';
      const to = request.query.to ? new Date(`${request.query.to}T23:59:59.999Z`).toISOString() : new Date().toISOString();
      const kind = request.params.kind;

      let body = '';
      if (kind === 'bookings') {
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('id, status, type, occasion, area, scheduled_at, duration_hours, price_usd, client_id, creator_id, created_at, cancelled_at')
          .gte('created_at', from)
          .lte('created_at', to)
          .order('created_at', { ascending: true });
        body = csv(data ?? [], ['id', 'status', 'type', 'occasion', 'area', 'scheduled_at', 'duration_hours', 'price_usd', 'client_id', 'creator_id', 'created_at', 'cancelled_at']);
      } else if (kind === 'payouts') {
        const { data } = await supabaseAdmin
          .from('creator_payouts')
          .select('id, creator_id, booking_id, amount_usd, fee_rate_applied, is_promo_rate, status, hold_until, available_at, paid_out_at, created_at')
          .gte('created_at', from)
          .lte('created_at', to)
          .order('created_at', { ascending: true });
        body = csv(data ?? [], ['id', 'creator_id', 'booking_id', 'amount_usd', 'fee_rate_applied', 'is_promo_rate', 'status', 'hold_until', 'available_at', 'paid_out_at', 'created_at']);
      } else if (kind === 'transactions') {
        const { data } = await supabaseAdmin
          .from('transactions')
          .select('id, booking_id, user_id, type, status, amount_usd, display_currency, xcd_peg_rate, created_at')
          .gte('created_at', from)
          .lte('created_at', to)
          .order('created_at', { ascending: true });
        body = csv(data ?? [], ['id', 'booking_id', 'user_id', 'type', 'status', 'amount_usd', 'display_currency', 'xcd_peg_rate', 'created_at']);
      } else {
        return reply.code(404).send({ error: 'kind must be bookings, payouts, or transactions' });
      }
      await audit(admin, 'csv_exported', kind, { from, to });
      reply.header('Content-Disposition', `attachment; filename="snapt-${kind}-${request.query.from ?? 'all'}-${request.query.to ?? 'now'}.csv"`);
      return reply.type('text/csv; charset=utf-8').send(body);
    },
  );
}
