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

export async function fetchMessages(bookingId: string): Promise<ChatMessage[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
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
