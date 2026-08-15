import { supabase, supabaseConfigured } from './supabase';

// Booking chat over Supabase Realtime (Phase 3). RLS restricts reads and
// writes to the booking's participants. In mock mode (no Supabase env) the
// session screen keeps its local scripted messages.

export interface ChatMessage {
  id: string;
  booking_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /** 'text' rows predate the column; treat undefined/null as 'text'. */
  kind?: 'text' | 'voice' | null;
  /** Storage path (no bucket prefix) — present only on kind='voice'. */
  audio_path?: string | null;
  duration_seconds?: number | null;
}

/**
 * Voice rows still carry a body — this literal — so the thread-list preview,
 * the push preview and build-16 bubbles (which predate the player and render
 * body text) all degrade to something honest instead of a blank line.
 */
export const VOICE_NOTE_BODY = '🎤 Voice note';

export const chatEnabled = supabaseConfigured;

/**
 * Thread history, or `null` if the read FAILED.
 *
 * The distinction matters: this used to discard `error` and return `[]`, so a
 * dropped connection or a denied read rendered as "No messages yet — say
 * hello." on a conversation that might hold weeks of history. A failure that
 * looks like an empty room is worse than an error, because the user believes
 * it and acts on it. `[]` now means genuinely empty and nothing else.
 */
export async function fetchMessages(bookingId: string): Promise<ChatMessage[] | null> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
  if (error) return null;
  return (data as ChatMessage[]) ?? [];
}

/**
 * Tell the server so the other participant gets a notification. Chat
 * writes bypass the API entirely (RLS, direct to Supabase), so without
 * this ping a message is the one event in the app that never reaches
 * anyone who isn't already looking at the thread.
 *
 * Deliberately not awaited and never able to throw: the message is
 * already saved and on its way over Realtime. A notification failure must
 * not make a sent message look unsent.
 */
function pingNotify(bookingId: string): void {
  void (async () => {
    try {
      const { apiBase, authHeaders } = await import('./api');
      if (!apiBase) return;
      await fetch(`${apiBase}/v1/messages/${bookingId}/notify`, {
        method: 'POST',
        headers: await authHeaders(),
      });
    } catch {
      /* best effort */
    }
  })();
}

export async function sendMessage(bookingId: string, body: string): Promise<ChatMessage | null> {
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('messages')
    .insert({ booking_id: bookingId, sender_id: auth.user.id, body })
    .select()
    .single();
  if (error) return null;
  pingNotify(bookingId);
  return data as ChatMessage;
}

/**
 * Insert the voice-note message row — called only AFTER the audio bytes are
 * safely in storage (the row references them; a row without bytes is a
 * bubble that can never play). Same RLS as text: participants only, creator
 * attached, not pending, both accounts active. The recipient's notification
 * previews VOICE_NOTE_BODY via the same ping.
 */
export async function sendVoiceMessage(
  bookingId: string,
  audioPath: string,
  durationSeconds: number,
): Promise<{ message: ChatMessage | null; errorCode?: string; errorMessage?: string }> {
  if (!supabase) return { message: null, errorMessage: 'no supabase client' };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { message: null, errorCode: 'signed_out', errorMessage: 'no authenticated user' };
  const { data, error } = await supabase
    .from('messages')
    .insert({
      booking_id: bookingId,
      sender_id: auth.user.id,
      body: VOICE_NOTE_BODY,
      kind: 'voice',
      audio_path: audioPath,
      duration_seconds: Math.max(1, Math.round(durationSeconds)),
    })
    .select()
    .single();
  // The error travels UP, never gets swallowed here: an RLS refusal (the
  // thread became unavailable) and a dropped connection need different
  // words on the bubble, and Sentry needs the real cause either way.
  if (error) return { message: null, errorCode: error.code, errorMessage: error.message };
  pingNotify(bookingId);
  return { message: data as ChatMessage };
}

/**
 * Live subscription; returns an unsubscribe function.
 *
 * `onLiveChange` reports whether the realtime channel is actually up. It used
 * to call `.subscribe()` with no status handler, so CHANNEL_ERROR and
 * TIMED_OUT were swallowed whole: nothing arrived live and the thread just
 * looked like the other person had gone quiet. Same failure-wearing-a-normal
 * -face problem as a swallowed send or a swallowed history read.
 *
 * `onCaughtUp` fires when the stream is ACTUALLY flowing, which is later
 * than SUBSCRIBED. Measured on production (2026-08-08): SUBSCRIBED acks the
 * socket join, but the postgres_changes registration confirms 150ms–1.5s
 * after it — sometimes seconds — and an insert committed in that window is
 * never delivered or replayed. Screens refetch history here, because this
 * is the first moment "everything before now" plus the live stream is
 * provably the whole conversation. Refires after reconnects, which also
 * heals whatever was missed while the channel was down.
 */
export function subscribeToMessages(
  bookingId: string,
  onMessage: (message: ChatMessage) => void,
  onLiveChange?: (live: boolean) => void,
  onCaughtUp?: () => void,
): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`messages:${bookingId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
      (payload) => onMessage(payload.new as ChatMessage),
    )
    .on('system', {}, (payload: { extension?: string; status?: string }) => {
      // "Subscribed to PostgreSQL" — the registration ack itself.
      if (payload?.extension === 'postgres_changes' && payload?.status === 'ok') onCaughtUp?.();
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onLiveChange?.(true);
      // CLOSED is also the normal teardown status, so it is deliberately not
      // treated as a fault — reporting it would flash a warning on unmount.
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onLiveChange?.(false);
    });
  return () => {
    client.removeChannel(channel);
  };
}
