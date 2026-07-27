import React from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { creatorById, useBookings } from '../../lib/store';
import { chatEnabled, fetchMessages, sendMessage, subscribeToMessages } from '../../lib/chat';
import { supabase } from '../../lib/supabase';
import { NO_SHOW_GRACE_MINUTES } from '../../lib/constants/business';
import { colors } from '../../lib/theme';

// Demo session-day state machine, matching the prototype's Advance-status
// control. Real states arrive with the Phase 1/4 backend.
type Stage = 'enroute' | 'arrived' | 'active' | 'wrapped';

const STAGE_COPY: Record<Stage, { headline: string; sub: string; badge: string; dot: string }> = {
  enroute: {
    headline: '{name} is on the way',
    sub: 'Track their arrival below — your safety code is ready when they get there.',
    badge: 'On the way',
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
  const [safetyOpen, setSafetyOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [endedForSafety, setEndedForSafety] = React.useState(false);

  const copy = STAGE_COPY[stage];
  const code = '4827';

  // Real chat when Supabase is configured; null = mock scripted message.
  const [chatMessages, setChatMessages] = React.useState<
    { id: string; body: string; mine: boolean }[] | null
  >(null);
  const [chatDraft, setChatDraft] = React.useState('');
  React.useEffect(() => {
    if (!chatEnabled || !bookingId) return;
    let uid: string | null = null;
    let unsub = () => {};
    supabase?.auth.getUser().then(({ data }) => {
      uid = data.user?.id ?? null;
      fetchMessages(bookingId).then((msgs) =>
        setChatMessages(msgs.map((m) => ({ id: m.id, body: m.body, mine: m.sender_id === uid }))),
      );
      unsub = subscribeToMessages(bookingId, (m) =>
        setChatMessages((prev) => [
          ...(prev ?? []),
          { id: m.id, body: m.body, mine: m.sender_id === uid },
        ]),
      );
    });
    return () => unsub();
  }, [bookingId]);

  const sendChat = async () => {
    const body = chatDraft.trim();
    if (!body) return;
    setChatDraft('');
    if (chatEnabled && bookingId) {
      await sendMessage(bookingId, body);
      // Realtime echo appends it; no optimistic row needed at this scale.
    } else {
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
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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

        {/* Map placeholder */}
        <View style={styles.map}>
          <View style={styles.mapLegend}>
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: colors.yellow, borderWidth: 1.5, borderColor: colors.ink }]} />
              <Text style={styles.legendLabel}>Your location</Text>
            </View>
            <View style={[styles.legendRow, { marginTop: 3 }]}>
              <View style={[styles.legendDot, { backgroundColor: colors.ink }]} />
              <Text style={styles.legendLabel}>{creator?.name ?? 'Creator'}</Text>
            </View>
          </View>
        </View>

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

        {/* Grace period — report unlocks only after countdown (handoff §8) */}
        {stage === 'enroute' && (
          <View style={styles.graceCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke="#8A6400" strokeWidth={1.9} />
                <Path d="M12 7.5V12l3 2" stroke="#8A6400" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={styles.graceTitle}>
                {graceRunning
                  ? graceLeft > 0
                    ? `Grace period: ${graceMin}:${String(graceSec).padStart(2, '0')} remaining`
                    : 'Grace period has ended'
                  : `${NO_SHOW_GRACE_MINUTES}-minute grace period applies`}
              </Text>
            </View>
            <Text style={styles.graceNote}>
              If {firstName} hasn't arrived {NO_SHOW_GRACE_MINUTES} minutes past your start time, you can
              report a no-show and get a full refund.
            </Text>
            <Pressable
              disabled={!graceRunning || graceLeft > 0}
              onPress={() => booking && router.push(`/bookings/${booking.id}/no-show-client`)}
              style={[styles.noShowBtn, (!graceRunning || graceLeft > 0) && styles.noShowBtnDisabled]}
            >
              <Text style={[styles.noShowBtnLabel, (!graceRunning || graceLeft > 0) && { color: '#A8A29A' }]}>
                {graceRunning && graceLeft === 0 ? 'Report a no-show' : 'Report unlocks after grace period'}
              </Text>
            </Pressable>
            {!graceRunning ? (
              <Pressable onPress={() => setGraceRunning(true)}>
                <Text style={styles.demoLink}>Start grace countdown (demo)</Text>
              </Pressable>
            ) : graceLeft > 0 ? (
              <Pressable onPress={() => setGraceLeft(0)}>
                <Text style={styles.demoLink}>Skip grace period (demo)</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {/* Share my session */}
        {stage === 'active' && !endedForSafety && (
          <Pressable
            onPress={() => showToast('Session details sent to your emergency contacts by SMS.')}
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
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        {stage === 'wrapped' && booking ? (
          <Pressable onPress={() => router.replace(`/bookings/${booking.id}`)} style={styles.wrapBtn}>
            <Text style={styles.wrapBtnLabel}>Session wrapped — track your edit</Text>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        ) : (
          stage === 'enroute' &&
          booking && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => router.push(`/bookings/${booking.id}/reschedule-blocked`)}
                style={styles.footerBtn}
              >
                <Text style={styles.footerBtnLabel}>Reschedule</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/bookings/${booking.id}/cancel`)}
                style={[styles.footerBtn, styles.footerBtnDanger]}
              >
                <Text style={[styles.footerBtnLabel, { color: '#B0392B' }]}>Cancel booking</Text>
              </Pressable>
            </View>
          )
        )}
        {stage !== 'wrapped' && (
          <Pressable onPress={advance} style={styles.advanceBtn}>
            <Text style={styles.advanceLabel}>Advance status (demo)</Text>
          </Pressable>
        )}
      </View>

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
                onPress={() => {
                  setSafetyOpen(false);
                  setEndedForSafety(true);
                  setStage('wrapped');
                  showToast('Session ended. No fees applied to either side.');
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
                onPress={() => {
                  setSafetyOpen(false);
                  showToast('Report sent. Our safety team is reviewing it now.');
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
            <ScrollView style={styles.chatBody}>
              {/* Real chat (Supabase Realtime) when configured; scripted
                  message in mock mode. */}
              {chatMessages === null ? (
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
            </ScrollView>
            <View style={styles.chatInputWrap}>
              <View style={styles.chatInputRow}>
                <TextInput
                  placeholder={`Message ${firstName}…`}
                  placeholderTextColor="#9A9A9A"
                  style={styles.chatInput}
                  value={chatDraft}
                  onChangeText={setChatDraft}
                  onSubmitEditing={sendChat}
                  returnKeyType="send"
                />
                <Pressable onPress={sendChat} style={styles.chatSend}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M4 12L20 4l-6 16-3-7-7-1z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                  </Svg>
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
    backgroundColor: colors.segBgAlt,
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 11, fontWeight: '700', color: colors.ink },
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
    paddingBottom: 30,
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
    paddingBottom: 28,
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
