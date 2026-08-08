import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { notify } from '../notify.js';

/**
 * The Messages tab: a list view onto the SAME per-booking threads that
 * lib/chat.ts already reads and writes (real-time, direct to Supabase,
 * RLS-scoped to the booking's two participants). Nothing here creates a new
 * kind of conversation — a thread exists only where a real booking exists,
 * and only once a creator is actually attached to it.
 *
 * `messages` carries no per-recipient read state, so unread was previously
 * uncomputable; message_reads (booking_id, user_id, last_read_at) fixes that.
 */

const CLOSED_DAYS = 7;

interface ThreadRow {
  booking_id: string;
  other_id: string;
  other_name: string;
  other_avatar: string | null;
  type: string;
  // Nullable for real: only in-person bookings collect an occasion. Remote
  // edit orders have no occasion step, so this is null for most of them.
  occasion: string | null;
  scheduled_at: string | null;
  status: string;
  delivered_at: string | null;
  last_message: { body: string; created_at: string; mine: boolean } | null;
  unread: number;
  closed: boolean;
}

/**
 * Every thread for `userId`, newest activity first. Shared by the list
 * endpoint and the unread-count endpoint so the two numbers can never drift
 * apart — the badge always agrees with what the list actually shows.
 */
async function loadThreads(userId: string): Promise<ThreadRow[]> {
  // A conversation exists once a creator is attached AND the booking has
  // moved off a bare, unaccepted offer — matches the empty-state copy
  // ("once a creator accepts a booking"). Client and creator sides both
  // resolve here; `other_id` below picks whichever one isn't `userId`.
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, client_id, creator_id, type, occasion, scheduled_at, status, delivered_at')
    .or(`client_id.eq.${userId},creator_id.eq.${userId}`)
    .not('creator_id', 'is', null)
    .neq('status', 'pending')
    .order('scheduled_at', { ascending: false, nullsFirst: false });
  if (!bookings?.length) return [];

  const bookingIds = bookings.map((b) => b.id);
  const otherIds = [
    ...new Set(bookings.map((b) => (b.client_id === userId ? b.creator_id : b.client_id) as string)),
  ];

  const [{ data: profiles }, { data: creatorRows }, { data: messages }, { data: reads }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, full_name, avatar_url').in('id', otherIds),
    supabaseAdmin
      .from('creator_profiles')
      .select('user_id, headshot_path, headshot_status')
      .in('user_id', otherIds),
    supabaseAdmin
      .from('messages')
      .select('booking_id, sender_id, body, created_at')
      .in('booking_id', bookingIds)
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('message_reads').select('booking_id, last_read_at').eq('user_id', userId).in('booking_id', bookingIds),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const readAt = new Map((reads ?? []).map((r) => [r.booking_id, r.last_read_at as string]));
  // Counterparty creators show their APPROVED headshot; clients (no
  // creator_profiles row / no approved headshot) fall back to avatar_url.
  const { createDownloadUrl } = await import('../storage.js');
  const headshotById = new Map<string, string>();
  for (const c of creatorRows ?? []) {
    if (c.headshot_status === 'approved' && c.headshot_path) {
      const url = await createDownloadUrl('portfolio', c.headshot_path).catch(() => null);
      if (url) headshotById.set(c.user_id as string, url);
    }
  }

  const lastMessage = new Map<string, { body: string; created_at: string; sender_id: string }>();
  const unreadCount = new Map<string, number>();
  for (const m of messages ?? []) {
    if (!lastMessage.has(m.booking_id)) lastMessage.set(m.booking_id, m);
    const since = readAt.get(m.booking_id);
    if (m.sender_id !== userId && (!since || m.created_at > since)) {
      unreadCount.set(m.booking_id, (unreadCount.get(m.booking_id) ?? 0) + 1);
    }
  }

  const threads: ThreadRow[] = bookings.map((b) => {
    const otherId = (b.client_id === userId ? b.creator_id : b.client_id) as string;
    const other = profileById.get(otherId);
    const last = lastMessage.get(b.id);
    const closed =
      b.status === 'completed' &&
      !!b.delivered_at &&
      Date.now() - new Date(b.delivered_at).getTime() > CLOSED_DAYS * 86_400_000;
    return {
      booking_id: b.id,
      other_id: otherId,
      // `||`, not `??` — full_name can be an empty string, not just null,
      // on an account that never completed profile setup.
      other_name: other?.full_name || 'Snapt user',
      other_avatar: headshotById.get(otherId) ?? other?.avatar_url ?? null,
      type: b.type,
      occasion: b.occasion ?? null,
      scheduled_at: b.scheduled_at,
      status: b.status,
      delivered_at: b.delivered_at,
      last_message: last
        ? { body: last.body, created_at: last.created_at, mine: last.sender_id === userId }
        : null,
      unread: unreadCount.get(b.id) ?? 0,
      closed,
    };
  });

  // Sort by real activity: last message time if there's ever been one,
  // otherwise the booking's own schedule — so a freshly confirmed booking
  // with no messages yet still lands in a sensible place, not at the bottom
  // by an implicit null-timestamp sort.
  threads.sort((a, b) => {
    const at = a.last_message?.created_at ?? a.scheduled_at ?? '';
    const bt = b.last_message?.created_at ?? b.scheduled_at ?? '';
    return bt.localeCompare(at);
  });
  return threads;
}

export function registerMessageRoutes(app: FastifyInstance): void {
  app.get('/v1/messages/threads', async (request) => {
    const user = requireUser(request);
    const threads = await loadThreads(user.id);
    return { threads, unread: threads.reduce((s, t) => s + t.unread, 0) };
  });

  /** Cheap poll target for the tab-bar badge — same computation, no list payload. */
  app.get('/v1/messages/unread', async (request) => {
    const user = requireUser(request);
    const threads = await loadThreads(user.id);
    return { unread: threads.reduce((s, t) => s + t.unread, 0) };
  });

  app.post<{ Params: { bookingId: string } }>('/v1/messages/:bookingId/read', async (request, reply) => {
    const user = requireUser(request);
    // Ownership check: only a participant may mark a thread read.
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('client_id, creator_id')
      .eq('id', request.params.bookingId)
      .maybeSingle();
    if (!booking || (booking.client_id !== user.id && booking.creator_id !== user.id)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    await supabaseAdmin
      .from('message_reads')
      .upsert(
        { booking_id: request.params.bookingId, user_id: user.id, last_read_at: new Date().toISOString() },
        { onConflict: 'booking_id,user_id' },
      );
    return { read: true };
  });

  /**
   * Fan out a chat notification to the OTHER participant.
   *
   * Chat messages are written client-side straight to Supabase under RLS, so
   * the server never sees a send — which is why a message has never produced
   * a notification of any kind. Rather than move the write (and risk the one
   * part of chat that currently works), the sender pings this after a
   * successful insert and the server does the fan-out.
   *
   * It trusts the caller for nothing: participation is checked here, the
   * recipient is derived from the booking rather than supplied, and the body
   * is read back from the database rather than taken from the request.
   */
  app.post<{ Params: { bookingId: string } }>('/v1/messages/:bookingId/notify', async (request, reply) => {
    const user = requireUser(request);
    const bookingId = request.params.bookingId;
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('client_id, creator_id, status')
      .eq('id', bookingId)
      .maybeSingle();
    if (!booking || (booking.client_id !== user.id && booking.creator_id !== user.id)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    // Same gate as loadThreads: no thread exists until a creator is attached
    // AND the offer is accepted. This endpoint skipped it, so a ping could
    // notify someone about a conversation their own inbox refused to show —
    // observed live on 2026-08-08 (message_received on a still-pending
    // booking). Same 404 as non-participants so nothing leaks.
    if (!booking.creator_id || booking.status === 'pending') {
      return reply.code(404).send({ error: 'Not found' });
    }
    const recipient = booking.client_id === user.id ? booking.creator_id : booking.client_id;
    if (!recipient) return { notified: false, reason: 'no_counterparty' };

    // The message body comes from the table, never the request — a caller
    // cannot use this endpoint to put words in someone else's notification.
    const { data: last } = await supabaseAdmin
      .from('messages')
      .select('body, sender_id, created_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || last.sender_id !== user.id) return { notified: false, reason: 'no_message' };

    // One ping per thread per 5 minutes. A back-and-forth exchange should
    // buzz someone's phone once, not once per line.
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', recipient)
      .eq('trigger_type', 'message_received')
      .eq('data->>booking_id', bookingId)
      .gte('created_at', since);
    if ((count ?? 0) > 0) return { notified: false, reason: 'throttled' };

    const { data: sender } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    // '||' not '??': a fresh profile has full_name '', which is not null.
    const name = (sender?.full_name || '').split(' ')[0] || 'Your booking';
    const preview = String(last.body ?? '');
    await notify(
      recipient,
      'message_received',
      `New message from ${name}`,
      preview.length > 120 ? `${preview.slice(0, 117)}…` : preview,
      { booking_id: bookingId, thread_id: bookingId },
    );
    return { notified: true };
  });
}
