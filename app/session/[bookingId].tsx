import React from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { creatorById, useBookings } from '../../lib/store';
import { chatEnabled, fetchMessages, sendMessage, subscribeToMessages } from '../../lib/chat';
import { apiConfigured } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { NO_SHOW_GRACE_MINUTES } from '../../lib/constants/business';
import { colors, insetBottom } from '../../lib/theme';

// Demo session-day state machine, matching the prototype's Advance-status
// control. Real states arrive with the Phase 1/4 backend.
type Stage = 'enroute' | 'arrived' | 'active' | 'wrapped';

const STAGE_COPY: Record<Stage, { headline: string; sub: string; badge: string; dot: string }> = {
  enroute: {
    headline: '{name} is on the way',
    sub: 'Track their arrival below — your safety code is ready when they get there.',
    badge: 'On the way · Arriving in 12 minutes',
    dot: colors.yellow,
  },
  arrived: {
    headline: 'Your creator has arrived',
    sub: 'Meet at your chosen spot and share your safety code to begin.',
    badge: 'Arrived at meeting point',
    dot: colors.success,
  },
  active: {
    headline: 'Session in progress',
    sub: 'Enjoy the moment — your creator has it covered.',
    badge: 'Session active',
    dot: colors.success,
  },
  wrapped: {
    headline: 'Session wrapped',
    sub: 'Your footage heads to editing next. Track it any time.',
    badge: 'Session complete',
    dot: colors.greyLight,
  },
};

export default function SessionDay() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings } = useBookings();
  const booking = bookings.find((b) => b.id === bookingId);
  const creator = creatorById(booking?.creatorId ?? null);
  const firstName = creator?.name.split(' ')[0] ?? 'your creator';

  const [stage, setStage] = React.useState<Stage>('enroute');
  const [graceLeft, setGraceLeft] = React.useState(NO_SHOW_GRACE_MINUTES * 60);
  const [graceRunning, setGraceRunning] = React.useState(false);
  // Demo-only previews (mock mode): simulated notice period + the
  // creator-cancelled variant. Real notice derives from the booking.
  const [demoNotice, setDemoNotice] = React.useState<'3 days' | '36 hrs' | '6 hrs'>('3 days');
  const [creatorCancelled, setCreatorCancelled] = React.useState(false);
  const [safetyOpen, setSafetyOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [endedForSafety, setEndedForSafety] = React.useState(false);

  const copy = STAGE_COPY[stage];

  // Real session state in API mode: the client checks in on arrival at this
  // screen, the safety code comes from the server, and the stage derives
  // from session timestamps (polled — the demo Advance control only drives
  // mock mode).
  const [realCode, setRealCode] = React.useState<string | null>(null);
  React.useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    import('../../lib/api').then(({ apiConfigured, checkInApi, fetchSessionApi }) => {
      if (!apiConfigured || !bookingId) return;
      checkInApi(bookingId);
      const poll = () =>
        fetchSessionApi(bookingId).then((s) => {
          if (stop || !s) return;
          setRealCode(s.safety_code);
          setStage(
            s.session_ended_at
              ? 'wrapped'
              : s.session_active_at
                ? 'active'
                : s.creator_checked_in_at
                  ? 'arrived'
                  : 'enroute',
          );
        });
      poll();
      timer = setInterval(poll, 8000);
    });
    return () => {
      stop = true;
      if (timer) clearInterval(timer);
    };
  }, [bookingId]);

  const code = realCode ?? '4827';

  // Real chat when Supabase is configured; null = mock scripted message.
  const [chatMessages, setChatMessages] = React.useState<
    { id: string; body: string; mine: boolean }[] | null
  >(null);
  const [chatDraft, setChatDraft] = React.useState('');
  const [chatSending, setChatSending] = React.useState(false);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const [chatHistoryFailed, setChatHistoryFailed] = React.useState(false);
  React.useEffect(() => {
    if (!chatEnabled || !bookingId) return;
    let uid: string | null = null;
    let unsub = () => {};
    supabase?.auth.getUser().then(({ data }) => {
      uid = data.user?.id ?? null;
      fetchMessages(bookingId).then((msgs) => {
        // null = the read failed. Don't render that as an empty conversation.
        if (msgs === null) {
          setChatHistoryFailed(true);
          setChatMessages([]);
          return;
        }
        setChatHistoryFailed(false);
        setChatMessages(msgs.map((m) => ({ id: m.id, body: m.body, mine: m.sender_id === uid })));
      });
      unsub = subscribeToMessages(bookingId, (m) =>
        setChatMessages((prev) => [
          ...(prev ?? []),
          { id: m.id, body: m.body, mine: m.sender_id === uid },
        ]),
      );
    });
    return () => unsub();
  }, [bookingId]);

  // Same rule as the standalone thread screen: the composer clears only once
  // the row is confirmed written. Clearing first and discarding the null
  // return meant a send with no signal destroyed the text in silence — worst
  // of all here, where people are mid-shoot and least able to retype.
  const sendChat = async () => {
    const body = chatDraft.trim();
    if (!body || chatSending) return;
    if (chatEnabled && bookingId) {
      setChatSending(true);
      setChatError(null);
      const sent = await sendMessage(bookingId, body);
      setChatSending(false);
      if (sent) {
        setChatDraft(''); // Realtime echo appends it; no optimistic row needed.
      } else {
        setChatError("Not sent — check your connection, then tap send again.");
      }
    } else {
      setChatDraft('');
      setChatMessages((prev) => [
        ...(prev ?? []),
        { id: `local-${Date.now()}`, body, mine: true },
      ]);
    }
  };

  React.useEffect(() => {
    if (!graceRunning || graceLeft <= 0) return;
    const t = setInterval(() => setGraceLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [graceRunning, graceLeft]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const advance = () => {
    if (stage === 'enroute') setStage('arrived');
    else if (stage === 'arrived') setStage('active');
    else if (stage === 'active') setStage('wrapped');
  };

  const graceMin = Math.floor(graceLeft / 60);
  const graceSec = graceLeft % 60;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Session day"
        right={
          stage === 'active' && !endedForSafety ? (
            <Pressable onPress={() => setSafetyOpen(true)} style={styles.safetyPill}>
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Path d="M12 3l7 2.5v5.6c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.5L12 3z" stroke={colors.error} strokeWidth={1.9} strokeLinejoin="round" />
                <Path d="M12 9v3.5M12 15.5h.01" stroke={colors.error} strokeWidth={1.9} strokeLinecap="round" />
              </Svg>
              <Text style={styles.safetyLabel}>Safety</Text>
            </Pressable>
          ) : undefined
        }
      />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {stage !== 'enroute' && (
        <>
        <View style={styles.headRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.headline}>{copy.headline.replace('{name}', firstName)}</Text>
            <Text style={styles.subhead}>{copy.sub}</Text>
          </View>
          <Pressable onPress={() => router.push('/help')} style={styles.helpChip}>
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
              <Path d="M12 3l7 2.5v5.6c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.5L12 3z" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinejoin="round" />
            </Svg>
            <Text style={styles.helpLabel}>Need help?</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => router.push('/help/report')} style={styles.reportRow}>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <Path d="M12 4l8.5 15h-17L12 4z" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinejoin="round" />
            <Path d="M12 10v4M12 16.5h.01" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" />
          </Svg>
          <Text style={styles.reportLabel}>Report an issue with this session</Text>
        </Pressable>
        </>
        )}
        

        {/* Creator card */}
        {creator && (
          <View style={styles.creatorCard}>
            <View style={styles.creatorPhoto}>
              <CreatorAvatar name={creator.name} photo={creator.photo} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.creatorName}>{creator.name}</Text>
              <Text style={styles.creatorRole}>Your creator</Text>
              <View style={styles.statusBadge}>
                <View style={[styles.statusDot, { backgroundColor: copy.dot }]} />
                <Text style={styles.statusLabel}>{copy.badge}</Text>
              </View>
            </View>
          </View>
        )}

        {stage === 'arrived' && (
          <View style={styles.codeInstruction}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" stroke="#1B9A57" strokeWidth={1.8} />
              <Path d="M8 10.5V8a4 4 0 018 0v2.5" stroke="#1B9A57" strokeWidth={1.8} />
            </Svg>
            <Text style={styles.codeInstructionText}>
              Share your code with {creator?.name ?? 'your creator'} to begin the session.
            </Text>
          </View>
        )}

        {/* Waiting card — reporting unlocks after the grace period (§8). */}
        {stage === 'enroute' && creatorCancelled && (
          <View style={styles.cancelledCard}>
            <Text style={styles.cancelledTitle}>{firstName} cancelled this session</Text>
            <Text style={styles.cancelledSub}>
              You get a full refund including all fees — or we can rematch you with another creator
              for the same time where availability allows.
            </Text>
          </View>
        )}
        {stage === 'enroute' && !creatorCancelled && (
          <View style={styles.waitCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke={colors.ink} strokeWidth={1.9} />
                <Path d="M12 7.5V12l3 2" stroke={colors.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={styles.graceTitle}>
                {graceRunning
                  ? `Waiting for ${firstName} · ${Math.floor((NO_SHOW_GRACE_MINUTES * 60 - graceLeft) / 60)}:${String((NO_SHOW_GRACE_MINUTES * 60 - graceLeft) % 60).padStart(2, '0')} elapsed`
                  : `Waiting for ${firstName}`}
              </Text>
            </View>
            <Text style={styles.graceNote}>
              Give {firstName} a few more minutes — reporting opens {NO_SHOW_GRACE_MINUTES} minutes
              after the scheduled start.
            </Text>
            <Pressable
              disabled={!graceRunning || graceLeft > 0}
              onPress={() => booking && router.push(`/bookings/${booking.id}/no-show-client`)}
              style={[styles.noShowBtn, (!graceRunning || graceLeft > 0) && styles.noShowBtnDisabled]}
            >
              <Text style={[styles.noShowBtnLabel, (!graceRunning || graceLeft > 0) && { color: '#A8A29A' }]}>
                {graceRunning
                  ? graceLeft > 0
                    ? `Available in ${graceMin}:${String(graceSec).padStart(2, '0')}`
                    : 'Report a no-show'
                  : 'Available after the grace period'}
              </Text>
            </Pressable>
            {!apiConfigured &&
              (!graceRunning ? (
                <Pressable onPress={() => setGraceRunning(true)}>
                  <Text style={styles.demoLink}>Start grace countdown (demo)</Text>
                </Pressable>
              ) : graceLeft > 0 ? (
                <Pressable onPress={() => setGraceLeft(0)}>
                  <Text style={styles.demoLink}>Skip grace period (demo)</Text>
                </Pressable>
              ) : null)}
          </View>
        )}

        {/* Share my session */}
        {stage === 'active' && !endedForSafety && (
          <Pressable
            onPress={async () => {
              // Email-based (Resend) — Snapt uses no SMS. Server pulls the
              // emergency contacts and sends the meeting details.
              const api = await import('../../lib/api');
              if (api.apiConfigured && bookingId) {
                const { authedShareSession } = api;
                const result = await authedShareSession(bookingId);
                if (result && 'error' in result) {
                  showToast(result.error);
                  return;
                }
              }
              showToast('Session details sent to your emergency contacts by email.');
            }}
            style={styles.shareCard}
          >
            <View style={styles.shareIcon}>
              <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
                <Path d="M4 12v6a2 2 0 002 2h12a2 2 0 002-2v-6" stroke="#1B9A57" strokeWidth={1.8} strokeLinecap="round" />
                <Path d="M12 15V4M8 8l4-4 4 4" stroke="#1B9A57" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.shareTitle}>Share my session</Text>
              <Text style={styles.shareSub}>
                Text your emergency contacts who you're with, where, and for how long.
              </Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        )}

        {endedForSafety && (
          <View style={styles.endedCard}>
            <Text style={styles.endedTitle}>Session ended for safety</Text>
            <Text style={styles.endedSub}>
              No cancellation fee was applied to either you or {creator?.name ?? 'your creator'}. Our
              safety team has your report and will be in touch.
            </Text>
          </View>
        )}

        {/* Safety code */}
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>YOUR SAFETY CODE</Text>
          <Text style={styles.codeValue}>{code}</Text>
          <Text style={styles.codeNote}>
            Share this with {creator?.name ?? 'your creator'} when they arrive, so you know it's really
            them.
          </Text>
        </View>
        {stage === 'enroute' && !creatorCancelled && booking && (
          <>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => router.push(`/bookings/${booking.id}/reschedule-blocked`)}
                style={styles.footerBtn}
              >
                <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                  <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.ink} strokeWidth={1.8} />
                  <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                </Svg>
                <Text style={styles.footerBtnLabel}>Reschedule</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/bookings/${booking.id}/cancel`)}
                style={[styles.footerBtn, styles.footerBtnDanger]}
              >
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke="#B0392B" strokeWidth={2.2} strokeLinecap="round" />
                </Svg>
                <Text style={[styles.footerBtnLabel, { color: '#B0392B' }]}>Cancel booking</Text>
              </Pressable>
            </View>
            <Text style={styles.noticeCaption}>
              {apiConfigured && booking.scheduledAt
                ? `${(() => {
                    const h = (new Date(booking.scheduledAt).getTime() - Date.now()) / 3600_000;
                    return h >= 48 ? `${Math.round(h / 24)} days' notice` : `${Math.max(Math.round(h), 0)} hrs' notice`;
                  })()}`
                : `${demoNotice}' notice`}
              {' · '}
              {new Date(booking.scheduledAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              {' · '}
              {new Date(booking.scheduledAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </Text>
          </>
        )}

        {/* Demo-only preview controls (mock mode). */}
        {!apiConfigured && stage === 'enroute' && (
          <View style={styles.demoCard}>
            <Text style={styles.demoOverline}>DEMO · NOTICE BEFORE SESSION</Text>
            <View style={styles.demoSegTrack}>
              {(['3 days', '36 hrs', '6 hrs'] as const).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setDemoNotice(n)}
                  style={[styles.demoSeg, demoNotice === n && styles.demoSegActive]}
                >
                  <Text style={[styles.demoSegLabel, demoNotice === n && styles.demoSegLabelActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setCreatorCancelled((v) => !v)}>
              <Text style={styles.demoToggle}>Toggle creator-cancelled state</Text>
            </Pressable>
          </View>
        )}
        {!apiConfigured && stage !== 'wrapped' && (
          <Pressable onPress={advance} style={styles.advanceBtn}>
            <Text style={styles.advanceLabel}>Advance status (demo)</Text>
          </Pressable>
        )}
        <View style={{ height: 24 }} />
      </KeyboardScrollView>

      {stage === 'wrapped' && booking && (
        <View style={styles.footer}>
          <Pressable onPress={() => router.replace(`/bookings/${booking.id}`)} style={styles.wrapBtn}>
            <Text style={styles.wrapBtnLabel}>Session wrapped — track your edit</Text>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        </View>
      )}

      <Pressable onPress={() => setChatOpen(true)} style={styles.chatFab}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H10l-4.5 3.5V15H6a2 2 0 01-2-2V6z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
      </Pressable>

      {toast && (
        <View style={styles.toast}>
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" style={{ marginTop: 1 }}>
            <Path d="M5 12.5l4 4L19 7" stroke={colors.success} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Safety sheet — End session is a PLAIN TAP by design (handoff §11):
          the deliberate exception to slide-to-confirm on high-stakes actions. */}
      <Modal visible={safetyOpen} transparent animationType="slide" onRequestClose={() => setSafetyOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setSafetyOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Safety options</Text>
            <Text style={styles.sheetSub}>
              Use these any time during a session. Ending a session for safety never costs you or your
              creator anything.
            </Text>
            <View style={styles.safetyList}>
              <Pressable
                onPress={async () => {
                  // Frictionless by design (§11): end first, server call is
                  // fire-and-forget — nothing gates this action.
                  setSafetyOpen(false);
                  setEndedForSafety(true);
                  setStage('wrapped');
                  showToast('Session ended. No fees applied to either side.');
                  const api = await import('../../lib/api');
                  if (api.apiConfigured && bookingId) api.endSessionSafetyApi(bookingId);
                }}
                style={[styles.safetyRow, styles.safetyRowBorder]}
              >
                <View style={[styles.safetyIcon, { backgroundColor: colors.segBgAlt }]}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Rect x="6" y="6" width="12" height="12" rx="2.5" stroke={colors.ink} strokeWidth={1.9} />
                  </Svg>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.safetyRowTitle}>End session</Text>
                  <Text style={styles.safetyRowSub}>Stops the session right now. No fee for either side.</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={async () => {
                  setSafetyOpen(false);
                  showToast('Report sent. Our safety team is reviewing it now.');
                  const api = await import('../../lib/api');
                  if (api.apiConfigured && bookingId) api.reportSafetyApi(bookingId, 'safety_concern');
                }}
                style={[styles.safetyRow, styles.safetyRowBorder]}
              >
                <View style={[styles.safetyIcon, { backgroundColor: '#FFF4D6' }]}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 4l8.5 15h-17L12 4z" stroke="#8A6400" strokeWidth={1.9} strokeLinejoin="round" />
                    <Path d="M12 10v4M12 16.5h.01" stroke="#8A6400" strokeWidth={1.9} strokeLinecap="round" />
                  </Svg>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.safetyRowTitle}>Report a safety concern</Text>
                  <Text style={styles.safetyRowSub}>Flags it to our team without ending the session.</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => Linking.openURL('tel:911')} style={styles.safetyRow}>
                <View style={[styles.safetyIcon, { backgroundColor: '#FDECEA' }]}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M6.4 3.5h3l1.5 4-2 1.4a12.5 12.5 0 006.2 6.2l1.4-2 4 1.5v3a2 2 0 01-2.2 2A16.5 16.5 0 014.4 5.7a2 2 0 012-2.2z" stroke={colors.error} strokeWidth={1.8} strokeLinejoin="round" />
                  </Svg>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.safetyRowTitle}>Call 911</Text>
                  <Text style={styles.safetyRowSub}>Dials emergency services directly — not Snapt support.</Text>
                </View>
              </Pressable>
            </View>
            <Pressable onPress={() => setSafetyOpen(false)} style={styles.sheetCloseBtn}>
              <Text style={styles.sheetCloseLabel}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Chat sheet */}
      <Modal visible={chatOpen} transparent animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setChatOpen(false)} />
          <View style={[styles.sheet, { paddingHorizontal: 0, paddingBottom: 14 }]}>
            <View style={styles.chatHead}>
              {creator && (
                <View style={styles.chatAvatar}>
                  <CreatorAvatar name={creator.name} photo={creator.photo} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.chatName}>{creator?.name ?? 'Creator'}</Text>
                <Text style={styles.chatRole}>Your creator</Text>
              </View>
              <Pressable onPress={() => setChatOpen(false)} style={styles.chatClose}>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>
            <KeyboardScrollView style={styles.chatBody}>
              {/* Real chat (Supabase Realtime) when configured; scripted
                  message in mock mode. */}
              {chatHistoryFailed ? (
                <View style={styles.chatError}>
                  <Text style={styles.chatErrorText}>
                    Couldn't load earlier messages — a connection problem, not lost history.
                  </Text>
                </View>
              ) : chatMessages === null ? (
                <View style={styles.chatMsgRow}>
                  {creator && (
                    <View style={styles.chatMsgAvatar}>
                      <CreatorAvatar name={creator.name} photo={creator.photo} />
                    </View>
                  )}
                  <View style={styles.chatBubble}>
                    <Text style={styles.chatBubbleText}>On my way! Running right on time — see you soon.</Text>
                  </View>
                </View>
              ) : (
                chatMessages.map((m) => (
                  <View
                    key={m.id}
                    style={[styles.chatMsgRow, m.mine && { justifyContent: 'flex-end' }]}
                  >
                    {!m.mine && creator && (
                      <View style={styles.chatMsgAvatar}>
                        <CreatorAvatar name={creator.name} photo={creator.photo} />
                      </View>
                    )}
                    <View style={[styles.chatBubble, m.mine && { backgroundColor: colors.yellowSoft }]}>
                      <Text style={styles.chatBubbleText}>{m.body}</Text>
                    </View>
                  </View>
                ))
              )}
            </KeyboardScrollView>
            <View style={styles.chatInputWrap}>
              {chatError && (
                <View style={styles.chatError}>
                  <Text style={styles.chatErrorText}>{chatError}</Text>
                </View>
              )}
              <View style={styles.chatInputRow}>
                <TextInput
                  placeholder={`Message ${firstName}…`}
                  placeholderTextColor="#9A9A9A"
                  style={styles.chatInput}
                  value={chatDraft}
                  onChangeText={(t) => {
                    setChatDraft(t);
                    if (chatError) setChatError(null);
                  }}
                  onSubmitEditing={sendChat}
                  returnKeyType="send"
                  editable={!chatSending}
                />
                <Pressable onPress={sendChat} style={styles.chatSend} disabled={chatSending}>
                  {chatSending ? (
                    <ActivityIndicator size="small" color={colors.ink} />
                  ) : (
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M4 12L20 4l-6 16-3-7-7-1z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                    </Svg>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 12 },
  safetyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ECECEC',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  safetyLabel: { fontSize: 12, fontWeight: '800', color: colors.ink },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headline: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  subhead: { fontSize: 14, color: colors.grey, marginTop: 6, lineHeight: 20 },
  helpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 11,
    marginTop: 3,
  },
  helpLabel: { fontSize: 10, fontWeight: '800', color: colors.yellowDark },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, alignSelf: 'flex-start' },
  reportLabel: { fontSize: 10, fontWeight: '800', color: colors.yellowDark },
  codeInstruction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#EAF8F0',
    borderWidth: 1,
    borderColor: '#C7EBD6',
    borderRadius: 12,
    padding: 11,
    paddingHorizontal: 13,
    marginTop: 14,
  },
  codeInstructionText: { flex: 1, fontSize: 10.5, color: '#12784A', lineHeight: 15, fontWeight: '700' },
  map: { height: 210, borderRadius: 16, backgroundColor: '#E5E2DB', marginTop: 16, overflow: 'hidden' },
  mapLegend: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { fontSize: 10.5, fontWeight: '600', color: colors.ink },
  creatorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    paddingHorizontal: 16,
    marginTop: 16,
    shadowColor: colors.ink,
    shadowOpacity: 0.09,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  creatorPhoto: { width: 52, height: 52, borderRadius: 26, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  creatorName: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  creatorRole: { fontSize: 12, color: colors.greyWarm, fontWeight: '600', marginTop: 1 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#FFF4D6',
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 11, fontWeight: '700', color: '#8A6800' },
  waitCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderTopWidth: 3,
    borderTopColor: colors.yellow,
    padding: 15,
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cancelledCard: {
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F6D5D2',
    borderRadius: 16,
    padding: 15,
    marginTop: 16,
  },
  cancelledTitle: { fontSize: 14.5, fontWeight: '800', color: '#B0392B' },
  cancelledSub: { fontSize: 12, color: '#8A5049', lineHeight: 18, marginTop: 6 },
  noticeCaption: {
    fontSize: 11,
    color: '#9A948B',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 10,
  },
  demoCard: {
    borderWidth: 1.5,
    borderColor: '#E0DCD2',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 13,
    marginTop: 18,
  },
  demoOverline: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: '#A8A29A' },
  demoSegTrack: { flexDirection: 'row', gap: 5, backgroundColor: '#F1EEE7', borderRadius: 11, padding: 3, marginTop: 9 },
  demoSeg: { flex: 1, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  demoSegActive: { backgroundColor: '#fff' },
  demoSegLabel: { fontSize: 11, fontWeight: '600', color: '#8A8377' },
  demoSegLabelActive: { color: colors.ink, fontWeight: '800' },
  demoToggle: { fontSize: 11, fontWeight: '700', color: colors.yellowDark, marginTop: 10 },
  graceCard: {
    backgroundColor: '#FFF9EC',
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 16,
    padding: 15,
    marginTop: 16,
  },
  graceTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  graceNote: { fontSize: 12, color: colors.grey, lineHeight: 18, marginTop: 8 },
  noShowBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 13,
  },
  noShowBtnDisabled: { backgroundColor: '#EFEDE7' },
  noShowBtnLabel: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  demoLink: { fontSize: 10.5, color: '#B4B1AA', fontWeight: '700', textAlign: 'center', marginTop: 9 },
  shareCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    paddingHorizontal: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  shareIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EAF8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareTitle: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  shareSub: { fontSize: 11.5, color: colors.greyWarm, marginTop: 2, lineHeight: 16 },
  endedCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderTopWidth: 4,
    borderTopColor: colors.success,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  endedTitle: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  endedSub: { fontSize: 12.5, color: '#5C574E', lineHeight: 19, marginTop: 7 },
  codeCard: { backgroundColor: colors.ink, borderRadius: 16, padding: 20, marginTop: 16, alignItems: 'center' },
  codeLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)', letterSpacing: 1, fontWeight: '600' },
  codeValue: { fontSize: 40, fontWeight: '800', letterSpacing: 8, color: '#fff', marginTop: 10, marginBottom: 8 },
  codeNote: { fontSize: 12.5, color: 'rgba(255,255,255,0.7)', lineHeight: 18, textAlign: 'center' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 10,
  },
  wrapBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  wrapBtnLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  footerBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBtnDanger: { borderColor: '#F1DADA' },
  footerBtnLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  advanceBtn: {
    height: 44,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  advanceLabel: { fontSize: 13, fontWeight: '600', color: colors.grey },
  chatFab: {
    position: 'absolute',
    right: 20,
    bottom: 190,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  toast: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 260,
    backgroundColor: colors.ink,
    borderRadius: 16,
    padding: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  toastText: { flex: 1, fontSize: 12.5, color: '#fff', lineHeight: 18, fontWeight: '600' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: Math.max(insetBottom + 12, 28),
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8D8', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  sheetSub: { fontSize: 12.5, color: colors.grey, lineHeight: 19, marginTop: 6 },
  safetyList: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  safetyRow: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16 },
  safetyRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F1F1' },
  safetyIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  safetyRowTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  safetyRowSub: { fontSize: 11.5, color: colors.greyWarm, marginTop: 2, lineHeight: 16 },
  sheetCloseBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  sheetCloseLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  chatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F1F1',
  },
  chatAvatar: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  chatName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  chatRole: { fontSize: 11.5, color: colors.grey },
  chatClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.segBgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBody: { padding: 14, paddingHorizontal: 16, maxHeight: 280 },
  chatMsgRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-end', marginBottom: 12 },
  chatMsgAvatar: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  chatBubble: {
    maxWidth: '82%',
    backgroundColor: colors.segBgAlt,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    padding: 10,
    paddingHorizontal: 13,
  },
  chatBubbleText: { fontSize: 13, lineHeight: 18, color: colors.ink },
  chatInputWrap: { paddingHorizontal: 14, paddingTop: 10 },
  chatError: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  chatErrorText: { fontSize: 13, color: '#A3261F' },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.offWhite,
    borderWidth: 1,
    borderColor: '#ECECEC',
    borderRadius: 14,
    padding: 6,
    paddingLeft: 14,
  },
  chatInput: { flex: 1, fontSize: 14, color: colors.ink, padding: 0 },
  chatSend: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
