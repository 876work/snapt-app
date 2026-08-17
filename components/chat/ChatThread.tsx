import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { KeyboardScrollView } from '../ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import Svg, { Path } from 'react-native-svg';
import { chatEnabled, fetchMessages, sendMessage, subscribeToMessages } from '../../lib/chat';
import { sendVoiceNote } from '../../lib/voiceNotes';
import {
  VoiceRecorderButton,
  VoiceRecordSheet,
  deleteRecordingFile,
  type RecordedVoiceNote,
} from './VoiceRecorderButton';
import { PendingVoiceNote, VoiceNoteBubble } from './VoiceNoteBubble';
import { useVoiceSends, type PendingVoiceSend } from '../../lib/voicePlayback';
import { apiBase, authHeaders } from '../../lib/api';
import { captureHandledError } from '../../lib/sentry';

const EMPTY_PENDING: PendingVoiceSend[] = [];
import { CreatorAvatar } from '../ui/CreatorAvatar';
import { colors, insetBottom } from '../../lib/theme';
import { STATUS_TONE, threadStatus, threadSubject } from '../../lib/threadStatus';

/**
 * ANDROID KEYBOARD INSET — deliberately scoped to this screen.
 *
 * Android has been edge-to-edge since SDK 54, so the window no longer
 * shrinks when the IME opens: the system delivers an inset instead of
 * resizing, and the app-wide KeyboardAvoidingView in app/_layout passes
 * `behavior={undefined}` on Android, which does nothing at all. The composer
 * is a pinned sibling BELOW the scroller, so KeyboardScrollView cannot reach
 * it either — that only scrolls the focused field inside the scroller, and
 * the composer is not in it. Net result: the composer sat under the
 * keyboard and the typing was invisible.
 *
 * Returns 0 on iOS, always. app/_layout's `behavior="padding"` already
 * works there, and a second shift stacked on top would double-lift the
 * composer. Fixing this in the root layout would move every screen in the
 * app at once, which is exactly what must not happen here.
 *
 * The FULL reported IME height is used on purpose. On edge-to-edge Android
 * that height spans the navigation-bar strip the keyboard draws over, so
 * subtracting the safe-area inset risks UNDER-lifting and reproducing the
 * bug; over-lifting only leaves a slightly larger gap.
 */
function useAndroidKeyboardInset(): number {
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    let shown: { remove: () => void } | undefined;
    let hidden: { remove: () => void } | undefined;
    try {
      shown = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
        setHeight(e.endCoordinates?.height ?? 0);
      });
      hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    } catch (err) {
      // Never silent: a thread that cannot track the keyboard IS the bug
      // being fixed here, so a failure has to be visible rather than quietly
      // restore the old broken behaviour.
      captureHandledError(err, 'chatThread:keyboard-listener');
    }
    return () => {
      shown?.remove();
      hidden?.remove();
    };
  }, []);
  return height;
}

/**
 * THE ONE CHAT IMPLEMENTATION.
 *
 * There were two. This screen's body, and a near-copy inside the session-day
 * sheet that had been forked partway through this one's fixes — it carried
 * send-failure recovery and the join-race refetch, but never got the
 * disabled-counterparty warning or the retry on a failed load, and it resolved
 * the counterparty through creatorById() against the LOCAL catalog. That last
 * one is why the sheet showed "Creator" with no name: a creator absent from
 * the featured list returns undefined. It also meant the sheet could never
 * work for a creator looking at a client, because clients are not in the
 * creator catalog at all.
 *
 * Both surfaces render this now, so a fix lands in both and voice notes gets
 * built once.
 *
 * lib/chat is untouched: sending, realtime and RLS are exactly where they
 * were. This is a move of the UI around them, not a change to them.
 */
export type ChatMode = 'full' | 'sheet';

export interface ChatThreadInfo {
  booking_id: string;
  other_id: string;
  other_name: string;
  /** The other account is switched off — sending is refused by RLS. */
  other_disabled?: boolean;
  other_avatar: string | null;
  type: 'in_person' | 'remote';
  /** null on remote orders — they have no occasion step. */
  occasion: string | null;
  scheduled_at: string | null;
  status: string;
  delivered_at: string | null;
  closed: boolean;
}

export function ChatThread({
  bookingId,
  mode = 'full',
  onThread,
}: {
  bookingId: string;
  mode?: ChatMode;
  /** Parent chrome (screen header, sheet header) needs the counterparty. */
  onThread?: (t: ChatThreadInfo | null) => void;
}) {
  const [thread, setThread] = React.useState<ChatThreadInfo | null>(null);
  const [threadState, setThreadState] = React.useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const scrollRef = React.useRef<ScrollView>(null);

  const loadThread = React.useCallback(async () => {
    if (!apiBase || !bookingId) return;
    try {
      const res = await fetch(`${apiBase}/v1/messages/threads`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { threads: ChatThreadInfo[] };
      const found = body.threads.find((t) => t.booking_id === bookingId);
      if (!found) {
        setThreadState('missing');
        return;
      }
      setThread(found);
      setThreadState('ready');
      onThread?.(found);
    } catch {
      setThreadState('error');
    }
  }, [bookingId, onThread]);

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
    {
      id: string;
      body: string;
      mine: boolean;
      created_at: string;
      kind?: 'text' | 'voice' | null;
      audio_path?: string | null;
      duration_seconds?: number | null;
    }[] | null
  >(null);
  const [draft, setDraft] = React.useState('');
  // 0 on iOS — see the hook. Applied to the frame, nowhere else.
  const androidKeyboard = useAndroidKeyboardInset();
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [historyFailed, setHistoryFailed] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [live, setLive] = React.useState(true);
  // Voice notes leaving this phone. Rows live in a MODULE-level store from
  // record-release until the confirmed message replaces them (or Delete
  // removes them) — an upload in flight or a failed send stays visible
  // across navigating away and back, never a note that quietly looks sent
  // (or quietly disappears with the screen).
  const pendingVoice = useVoiceSends((s) => s.pendingByBooking[bookingId]) ?? EMPTY_PENDING;
  const upsertPending = useVoiceSends((s) => s.upsertPending);
  const removePending = useVoiceSends((s) => s.removePending);
  const markFailed = useVoiceSends((s) => s.markFailed);
  const [recordingHold, setRecordingHold] = React.useState(false);
  const [trayOpen, setTrayOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  // A hold-recording ended by a call or backgrounding, awaiting the
  // explicit send/discard decision (spec: never silently lose a partial).
  // Module-level for the same reason as pending sends.
  const interrupted = useVoiceSends((s) => s.interruptedByBooking[bookingId]) ?? null;
  const setInterruptedFor = useVoiceSends((s) => s.setInterrupted);

  React.useEffect(() => {
    if (!chatEnabled || !bookingId) return;
    let uid: string | null = null;
    let unsub = () => {};
    import('../../lib/supabase').then(({ supabase }) => {
      supabase?.auth.getUser().then(({ data }) => {
        uid = data.user?.id ?? null;
        const row = (m: {
          id: string;
          body: string;
          sender_id: string;
          created_at: string;
          kind?: 'text' | 'voice' | null;
          audio_path?: string | null;
          duration_seconds?: number | null;
        }) => ({
          id: m.id,
          body: m.body,
          mine: m.sender_id === uid,
          created_at: m.created_at,
          kind: m.kind ?? 'text',
          audio_path: m.audio_path ?? null,
          duration_seconds: m.duration_seconds ?? null,
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
            // Id-deduped: a voice send appends its confirmed row directly,
            // and the realtime echo of that same insert must not double it.
            setMessages((prev) =>
              (prev ?? []).some((p) => p.id === m.id) ? prev : [...(prev ?? []), row(m)],
            );
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
    // New message, either direction (pending voice bubbles included) —
    // keep the latest line in view.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages?.length, pendingVoice.length]);

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

  /**
   * Voice send: optimistic bubble → upload+insert via lib/voiceNotes → on
   * success the confirmed row replaces the pending one (the realtime echo
   * is id-deduped above); on failure the bubble turns into Not sent with
   * Retry + Delete. `existingTempId` makes Retry reuse the same bubble.
   */
  const sendVoice = React.useCallback(
    async (rec: { uri: string; durationSec: number }, existingTempId?: string) => {
      const tempId = existingTempId ?? `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      upsertPending(bookingId, {
        tempId,
        uri: rec.uri,
        durationSec: rec.durationSec,
        status: 'uploading',
      });
      const result = await sendVoiceNote(bookingId, rec.uri, rec.durationSec);
      if (result.ok) {
        const m = result.message;
        removePending(bookingId, tempId);
        setMessages((prev) =>
          (prev ?? []).some((p) => p.id === m.id)
            ? prev
            : [
                ...(prev ?? []),
                {
                  id: m.id,
                  body: m.body,
                  mine: true,
                  created_at: m.created_at,
                  kind: 'voice' as const,
                  audio_path: m.audio_path ?? null,
                  duration_seconds: m.duration_seconds ?? null,
                },
              ],
        );
        // Sent — playback now streams from storage; the cache copy is done.
        void deleteRecordingFile(rec.uri);
      } else {
        markFailed(bookingId, tempId, result.error);
      }
    },
    [bookingId, upsertPending, removePending, markFailed],
  );

  const handleRecorded = React.useCallback(
    (rec: RecordedVoiceNote) => {
      if (rec.interrupted) {
        // A call or backgrounding cut this off — the partial recording is
        // kept and the user decides. Never silently lost, never auto-sent.
        setInterruptedFor(bookingId, rec);
        setSheetOpen(true);
      } else {
        void sendVoice(rec);
      }
    },
    [sendVoice, bookingId, setInterruptedFor],
  );

  // An interruption stored while this thread was previously open (or while
  // navigating) re-surfaces its send/discard sheet on return — the decision
  // is deferred, never dropped.
  React.useEffect(() => {
    if (interrupted && !sheetOpen) setSheetOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interrupted]);

  if (threadState === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.yellowDark} />
      </View>
    );
  }

  if (threadState !== 'ready' || !thread) {
    return (
      <View style={styles.centre}>
        <Text style={styles.emptyTitle}>
          {threadState === 'missing' ? 'Conversation not found' : "Couldn't load this conversation"}
        </Text>
      </View>
    );
  }

  const { phrase, tone } = threadStatus(thread);

  const Frame = mode === 'sheet' ? KeyboardAvoidingView : View;
  // A Modal renders in its own native hierarchy, so the app-wide
  // KeyboardAvoidingView in app/_layout does not reach it — the sheet needs
  // its own or the composer stays behind the keyboard.
  //
  // On Android BOTH modes need the inset below: `behavior={undefined}` is a
  // no-op there, in the sheet and in the full screen alike. Padding a
  // flex:1 root shrinks the area its children lay out in, which is exactly
  // the window-resize the platform stopped doing — the scroller gives up
  // the height and the composer rides above the keyboard. On iOS
  // androidKeyboard is always 0, so this is literally styles.root and
  // nothing there changes.
  const frameStyle = androidKeyboard > 0 ? [styles.root, { paddingBottom: androidKeyboard }] : styles.root;
  const frameProps =
    mode === 'sheet'
      ? { behavior: Platform.OS === 'ios' ? ('padding' as const) : undefined, style: frameStyle }
      : { style: frameStyle };

  return (
    <Frame {...frameProps}>
      <Text style={styles.subject}>
        {threadSubject(thread)} <Text style={{ color: STATUS_TONE[tone] }}>· {phrase}</Text>
      </Text>

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
        ) : messages.length === 0 && pendingVoice.length === 0 ? (
          /* This was one grey line in a screenful of nothing. An empty thread
             is the one place with no content of its own, so it answers the
             three questions you would otherwise leave to find out: who this
             is with, what the booking is, and when it happens. */
          <View style={styles.startCard}>
            <View style={styles.startAvatar}>
              <CreatorAvatar
                name={thread.other_name}
                photo={thread.other_avatar ? { uri: thread.other_avatar } : null}
                textSize={22}
              />
            </View>
            <Text style={styles.startName}>{thread.other_name}</Text>
            <Text style={styles.startSubject}>
              {threadSubject(thread)} <Text style={{ color: STATUS_TONE[tone] }}>· {phrase}</Text>
            </Text>
            {/* No invitation to send when sending is refused. A closed thread
                and a switched-off account each explain themselves below the
                composer already — saying "send the first message" above one of
                those would be the app arguing with itself. */}
            {!thread.closed && !thread.other_disabled && (
              <Text style={styles.startHint}>
                No messages yet — send the first one and {thread.other_name.split(' ')[0]} gets a
                notification.
              </Text>
            )}
            {(thread.closed || thread.other_disabled) && (
              <Text style={styles.startHint}>No messages were sent on this booking.</Text>
            )}
          </View>
        ) : (
          <>
            {messages.map((m) => (
              <View key={m.id} style={[styles.msgRow, m.mine && { justifyContent: 'flex-end' }]}>
                <View style={[styles.bubble, m.mine && styles.bubbleMine]}>
                  {m.kind === 'voice' && m.audio_path ? (
                    <VoiceNoteBubble
                      bookingId={bookingId}
                      messageId={m.id}
                      audioPath={m.audio_path}
                      durationSeconds={m.duration_seconds ?? 0}
                      mine={m.mine}
                    />
                  ) : (
                    <Text style={styles.bubbleText}>{m.body}</Text>
                  )}
                </View>
              </View>
            ))}
            {pendingVoice.map((p) => (
              <View key={p.tempId} style={[styles.msgRow, { justifyContent: 'flex-end' }]}>
                <View style={[styles.bubble, styles.bubbleMine]}>
                  <PendingVoiceNote
                    durationSeconds={p.durationSec}
                    status={p.status}
                    error={p.error}
                    onRetry={() => void sendVoice({ uri: p.uri, durationSec: p.durationSec }, p.tempId)}
                    onDelete={() => {
                      removePending(bookingId, p.tempId);
                      void deleteRecordingFile(p.uri);
                    }}
                  />
                </View>
              </View>
            ))}
          </>
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
          {/* The other account is switched off. RLS refuses the insert, so
              leaving the composer live would produce a send that looks sent
              and never arrives. The history stays readable — nobody loses the
              record of the conversation. */}
          {thread.other_disabled && (
            <View style={styles.sendError}>
              <Text style={styles.sendErrorText}>
                {thread.other_name.split(' ')[0]}'s account is switched off. You can still read this
                conversation, but new messages won't reach them.
              </Text>
            </View>
          )}
          <View style={styles.inputRow}>
            {!recordingHold && (
              <Pressable
                onPress={() => setTrayOpen(true)}
                disabled={thread.other_disabled}
                style={styles.trayButton}
                accessibilityLabel="Add an attachment"
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M12 5v14M5 12h14"
                    stroke={thread.other_disabled ? '#B9B9B9' : colors.grey}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </Svg>
              </Pressable>
            )}
            {!recordingHold && (
              <TextInput
                placeholder={
                  thread.other_disabled
                    ? 'This account is switched off'
                    : `Message ${thread.other_name.split(' ')[0]}…`
                }
                placeholderTextColor="#9A9A9A"
                style={styles.input}
                value={draft}
                onChangeText={(t) => {
                  setDraft(t);
                  if (sendError) setSendError(null);
                }}
                onSubmitEditing={send}
                returnKeyType="send"
                editable={!sending && !thread.other_disabled}
              />
            )}
            {draft.trim() ? (
              <Pressable
                onPress={send}
                style={styles.send}
                disabled={!draft.trim() || sending || thread.other_disabled}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : (
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M4 12L20 4l-6 16-3-7-7-1z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                  </Svg>
                )}
              </Pressable>
            ) : (
              /* Empty composer: the send arrow gives way to the mic. Same
                 gating as text — a switched-off counterparty disables both. */
              <VoiceRecorderButton
                disabled={thread.other_disabled || sending}
                onRecorded={handleRecorded}
                onRecordingChange={setRecordingHold}
              />
            )}
          </View>
          {/* Attachment tray — one tile today (voice note); the thread
              redesign adds more without touching the recorder. */}
          <Modal
            visible={trayOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setTrayOpen(false)}
          >
            <Pressable style={styles.trayBackdrop} onPress={() => setTrayOpen(false)}>
              <Pressable style={styles.traySheet} onPress={() => undefined}>
                <Pressable
                  style={styles.trayTile}
                  onPress={() => {
                    setTrayOpen(false);
                    setSheetOpen(true);
                  }}
                >
                  <View style={styles.trayTileIcon}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
                        stroke={colors.ink}
                        strokeWidth={1.7}
                        strokeLinecap="round"
                      />
                    </Svg>
                  </View>
                  <Text style={styles.trayTileLabel}>Voice note</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
          <VoiceRecordSheet
            visible={sheetOpen}
            pending={interrupted}
            onClose={() => {
              setSheetOpen(false);
              setInterruptedFor(bookingId, null);
            }}
            onSend={(rec) => void sendVoice(rec)}
          />
        </View>
      )}
    </Frame>
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
  startCard: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 52 },
  startAvatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    overflow: 'hidden',
    backgroundColor: '#EFEBE3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  startName: { fontSize: 16.5, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  startSubject: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.yellowDark,
    textAlign: 'center',
    marginTop: 4,
  },
  startHint: {
    fontSize: 13,
    color: colors.grey,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 14,
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
  trayButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  trayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,18,12,0.35)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  traySheet: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    marginBottom: Math.max(insetBottom, 12),
  },
  trayTile: { alignItems: 'center', gap: 6, width: 76 },
  trayTileIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayTileLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  closedNote: {
    marginHorizontal: 14,
    marginBottom: Math.max(insetBottom, 14),
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#F1EEE7',
  },
  closedNoteText: { fontSize: 12.5, color: colors.grey, lineHeight: 18, textAlign: 'center' },
});
