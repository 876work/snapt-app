import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { KeyboardScrollView } from '../../../components/ui/KeyboardScrollView';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text, TextInput } from '../../../lib/text';
import Svg, { Path } from 'react-native-svg';
import { chatEnabled, fetchMessages, sendMessage, subscribeToMessages } from '../../../lib/chat';
import { apiBase, authHeaders } from '../../../lib/api';
import { CreatorAvatar } from '../../../components/ui/CreatorAvatar';
import { colors, insetBottom } from '../../../lib/theme';

/**
 * One conversation thread. Real messages (lib/chat.ts, Supabase Realtime,
 * RLS-scoped to the booking's two participants) — the same table the
 * session-day chat already reads and writes. This screen is a second, full
 * entry point onto the SAME data, not a separate chat system.
 */
interface Thread {
  booking_id: string;
  other_id: string;
  other_name: string;
  other_avatar: string | null;
  type: 'in_person' | 'remote';
  /** null on remote orders — they have no occasion step. */
  occasion: string | null;
  scheduled_at: string | null;
  status: string;
  delivered_at: string | null;
  closed: boolean;
}

// Mirrors the inbox list: a null occasion must never reach a template literal.
function subjectFor(t: Thread): string {
  if (t.type === 'remote') return t.occasion ? `Remote order · ${t.occasion}` : 'Remote order';
  const label = t.occasion ?? 'Session';
  if (!t.scheduled_at) return label;
  const d = new Date(t.scheduled_at);
  return `${label} · ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

export default function MessageThread() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [thread, setThread] = React.useState<Thread | null>(null);
  const [threadState, setThreadState] = React.useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const scrollRef = React.useRef<ScrollView>(null);

  const loadThread = React.useCallback(async () => {
    if (!apiBase || !bookingId) return;
    try {
      const res = await fetch(`${apiBase}/v1/messages/threads`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { threads: Thread[] };
      const found = body.threads.find((t) => t.booking_id === bookingId);
      if (!found) {
        setThreadState('missing');
        return;
      }
      setThread(found);
      setThreadState('ready');
    } catch {
      setThreadState('error');
    }
  }, [bookingId]);

  const markRead = React.useCallback(() => {
    if (!apiBase || !bookingId) return;
    authHeaders().then((headers) =>
      fetch(`${apiBase}/v1/messages/${bookingId}/read`, { method: 'POST', headers }).catch(() => undefined),
    );
  }, [bookingId]);

  // Refetch header/closed state on focus, and mark the thread read the
  // moment it's opened — this is what clears the tab badge and the row's
  // unread indicator without waiting for a poll.
  useFocusEffect(
    React.useCallback(() => {
      loadThread();
      markRead();
    }, [loadThread, markRead]),
  );

  const [messages, setMessages] = React.useState<
    { id: string; body: string; mine: boolean; created_at: string }[] | null
  >(null);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [historyFailed, setHistoryFailed] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [live, setLive] = React.useState(true);

  React.useEffect(() => {
    if (!chatEnabled || !bookingId) return;
    let uid: string | null = null;
    let unsub = () => {};
    import('../../../lib/supabase').then(({ supabase }) => {
      supabase?.auth.getUser().then(({ data }) => {
        uid = data.user?.id ?? null;
        const row = (m: { id: string; body: string; sender_id: string; created_at: string }) => ({
          id: m.id, body: m.body, mine: m.sender_id === uid, created_at: m.created_at,
        });
        fetchMessages(bookingId).then((msgs) => {
          // null means the read failed. Showing an empty thread here would
          // tell someone their history is gone.
          if (msgs === null) {
            setHistoryFailed(true);
            setMessages([]);
            return;
          }
          setHistoryFailed(false);
          setMessages(msgs.map(row));
        });
        unsub = subscribeToMessages(
          bookingId,
          (m) => {
            setMessages((prev) => [...(prev ?? []), row(m)]);
            // A message arriving while the thread is open is read the instant
            // it renders — don't let it sit in the unread count behind it.
            if (m.sender_id !== uid) markRead();
          },
          setLive,
          () => {
            // The stream is confirmed flowing only NOW (postgres_changes
            // registration ack) — measured up to seconds after SUBSCRIBED.
            // A message committed between the fetch above and this moment
            // was never going to stream and never going to be refetched:
            // invisible until the screen reopened. Refetch and merge by id;
            // fetched is the base, live arrivals newer than the snapshot are
            // kept. A failed refetch changes nothing — the initial load
            // already drew the screen, and this heals on the next ack.
            fetchMessages(bookingId).then((msgs) => {
              if (msgs === null) return;
              setHistoryFailed(false);
              setMessages((prev) => {
                const seen = new Set(msgs.map((m) => m.id));
                return [...msgs.map(row), ...(prev ?? []).filter((p) => !seen.has(p.id))];
              });
            });
          },
        );
      });
    });
    return () => unsub();
  }, [bookingId, markRead, reloadKey]);

  React.useEffect(() => {
    // New message, either direction — keep the latest line in view.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages?.length]);

  // The composer is cleared only once the row is confirmed written. It used
  // to clear first and discard sendMessage's null return, so a send with no
  // connection destroyed the typed text and showed nothing at all — no
  // error, no pending row, no queue. Silent data loss.
  //
  // This is the design-neutral half of the fix: never lose the words, always
  // say when a send failed. A real offline outbox (queue and retry) is a
  // separate decision and is NOT implemented here.
  const send = async () => {
    const body = draft.trim();
    if (!body || !bookingId || sending) return;
    setSending(true);
    setSendError(null);
    const sent = await sendMessage(bookingId, body);
    setSending(false);
    if (sent) {
      setDraft(''); // Realtime echo appends it; no optimistic row needed.
    } else {
      setSendError("Not sent — check your connection, then tap send again.");
    }
  };

  if (threadState === 'loading') {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Conversation" />
        <View style={styles.centre}>
          <ActivityIndicator color={colors.yellowDark} />
        </View>
      </View>
    );
  }

  if (threadState !== 'ready' || !thread) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Conversation" />
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>
            {threadState === 'missing' ? 'Conversation not found' : "Couldn't load this conversation"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={thread.other_name}
        right={
          <View style={styles.headerAvatar}>
            <CreatorAvatar
              name={thread.other_name}
              photo={thread.other_avatar ? { uri: thread.other_avatar } : null}
              textSize={13}
            />
          </View>
        }
      />
      <Text style={styles.subject}>{subjectFor(thread)}</Text>

      <KeyboardScrollView ref={scrollRef} style={styles.body} contentContainerStyle={{ paddingVertical: 12 }}>
        {messages === null ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        ) : historyFailed ? (
          <View style={styles.centre}>
            <Text style={styles.emptyBody}>
              Couldn't load this conversation. Your messages are safe — this is a connection
              problem, not lost history.
            </Text>
            <Pressable onPress={() => setReloadKey((k) => k + 1)} style={styles.retry}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.centre}>
            <Text style={styles.emptyBody}>No messages yet — say hello.</Text>
          </View>
        ) : (
          messages.map((m) => (
            <View key={m.id} style={[styles.msgRow, m.mine && { justifyContent: 'flex-end' }]}>
              <View style={[styles.bubble, m.mine && styles.bubbleMine]}>
                <Text style={styles.bubbleText}>{m.body}</Text>
              </View>
            </View>
          ))
        )}
      </KeyboardScrollView>

      {thread.closed ? (
        <View style={styles.closedNote}>
          <Text style={styles.closedNoteText}>
            This conversation is closed — delivery completed more than 7 days ago. You can still
            read it, but new messages can't be sent here.
          </Text>
        </View>
      ) : (
        <View style={styles.inputWrap}>
          {!live && !historyFailed && (
            <Pressable onPress={() => setReloadKey((k) => k + 1)} style={styles.offline}>
              <Text style={styles.offlineText}>
                Not receiving live updates — tap to reconnect.
              </Text>
            </Pressable>
          )}
          {sendError && (
            <View style={styles.sendError}>
              <Text style={styles.sendErrorText}>{sendError}</Text>
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              placeholder={`Message ${thread.other_name.split(' ')[0]}…`}
              placeholderTextColor="#9A9A9A"
              style={styles.input}
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                if (sendError) setSendError(null);
              }}
              onSubmitEditing={send}
              returnKeyType="send"
              editable={!sending}
            />
            <Pressable onPress={send} style={styles.send} disabled={!draft.trim() || sending}>
              {sending ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M4 12L20 4l-6 16-3-7-7-1z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                </Svg>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: colors.grey, textAlign: 'center' },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: '#EFEBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subject: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.yellowDark,
    paddingHorizontal: 22,
    marginTop: -4,
    marginBottom: 4,
  },
  body: { flex: 1, paddingHorizontal: 16 },
  msgRow: { flexDirection: 'row', marginBottom: 10 },
  bubble: {
    maxWidth: '78%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  bubbleMine: {
    backgroundColor: colors.yellowSoft,
    borderColor: colors.yellowSoftBorder,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 13.5, lineHeight: 19, color: colors.ink },
  offline: {
    backgroundColor: '#FFF4D6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  offlineText: { fontSize: 13, color: '#7A5B12' },
  retry: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.yellow,
  },
  retryLabel: { fontSize: 14, color: colors.ink },
  sendError: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  sendErrorText: { fontSize: 13, color: '#A3261F' },
  inputWrap: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: Math.max(insetBottom, 14),
    borderTopWidth: 1,
    borderTopColor: '#EFEBE3',
    backgroundColor: colors.offWhite,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E7E7',
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 6,
    height: 48,
  },
  input: { flex: 1, fontSize: 14, color: colors.ink, padding: 0 },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedNote: {
    marginHorizontal: 14,
    marginBottom: Math.max(insetBottom, 14),
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#F1EEE7',
  },
  closedNoteText: { fontSize: 12.5, color: colors.grey, lineHeight: 18, textAlign: 'center' },
});
