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
}

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
  // Tell the server so the other participant gets a notification. Chat
  // writes bypass the API entirely (RLS, direct to Supabase), so without
  // this ping a message is the one event in the app that never reaches
  // anyone who isn't already looking at the thread.
  //
  // Deliberately not awaited and never able to throw: the message is
  // already saved and on its way over Realtime. A notification failure must
  // not make a sent message look unsent.
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
  return data as ChatMessage;
}

/** Live subscription; returns an unsubscribe function. */
export function subscribeToMessages(
  bookingId: string,
  onMessage: (message: ChatMessage) => void,
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
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
