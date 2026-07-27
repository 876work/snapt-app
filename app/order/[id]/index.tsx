import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { CreatorAvatar } from '../../../components/ui/CreatorAvatar';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { creatorById, useBookings } from '../../../lib/store';
import { FREE_REVISIONS_PER_ORDER } from '../../../lib/constants/business';
import { colors } from '../../../lib/theme';

// Edit-status tracker: Received → In progress → Ready (demo-advanced).
type Step = 0 | 1 | 2;

const STEP_COPY: Record<Step, { title: string; desc: string }> = {
  0: {
    title: 'Files received',
    desc: "Your footage landed safely. We're assigning it to your editor now.",
  },
  1: {
    title: 'Your edit is in progress',
    desc: 'Your editor is working through your files with your chosen style.',
  },
  2: {
    title: 'Your edit is ready!',
    desc: 'Everything is polished and waiting for you. Take a look below.',
  },
};

export default function OrderTracker() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const creator = creatorById(booking?.creatorId ?? null) ?? creatorById('jordan');

  const [step, setStep] = React.useState<Step>(1);
  const [chatOpen, setChatOpen] = React.useState(false);
  const copy = STEP_COPY[step];
  const firstName = creator?.name.split(' ')[0] ?? 'your editor';

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your order" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.metaRow}>
          <View>
            <Text style={styles.orderId}>Order #{String(id).replace('bk-', 'SN-')}</Text>
            <Text style={styles.eta}>{step === 2 ? 'Ready to download' : 'Est. delivery in 2 days'}</Text>
          </View>
          <Pressable onPress={() => router.push('/help/report')} style={styles.reportChip}>
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
              <Path d="M12 4l8.5 15h-17L12 4z" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinejoin="round" />
              <Path d="M12 10v4M12 16.5h.01" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" />
            </Svg>
            <Text style={styles.reportChipLabel}>Report an issue</Text>
          </Pressable>
        </View>

        {/* Horizontal stepper */}
        <View style={styles.stepperCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {[0, 1, 2].map((i) => (
              <React.Fragment key={i}>
                {i > 0 && <View style={[styles.connector, step >= i && styles.connectorDone]} />}
                <View style={[styles.dot, step >= i ? styles.dotDone : styles.dotIdle]}>
                  {step > i || (step === 2 && i === 2) ? (
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 13l4 4L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  ) : (
                    <View style={[styles.innerDot, step === i && { backgroundColor: colors.ink }]} />
                  )}
                </View>
              </React.Fragment>
            ))}
          </View>
          <View style={styles.stepLabels}>
            <Text style={[styles.stepLabel, step >= 0 && styles.stepLabelActive]}>Received</Text>
            <Text style={[styles.stepLabel, { textAlign: 'center' }, step >= 1 && styles.stepLabelActive]}>
              In progress
            </Text>
            <Text style={[styles.stepLabel, { textAlign: 'right' }, step >= 2 && styles.stepLabelActive]}>
              Ready
            </Text>
          </View>
        </View>

        {/* Status card */}
        <View style={styles.statusCard}>
          <View style={styles.statusIcon}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Rect x="2.5" y="6.5" width="19" height="13" rx="3" stroke={colors.ink} strokeWidth={1.8} />
              <Circle cx="12" cy="13" r="3.6" stroke={colors.ink} strokeWidth={1.8} />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{copy.title}</Text>
            <Text style={styles.statusDesc}>{copy.desc}</Text>
            {step === 1 && (
              <View style={styles.timeChip}>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.9} />
                  <Path d="M12 7.5V12l3 2" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" />
                </Svg>
                <Text style={styles.timeChipLabel}>Usually takes 2–4 hours</Text>
              </View>
            )}
          </View>
        </View>

        {/* Creator card */}
        {creator && (
          <View style={styles.creatorCard}>
            <View style={styles.creatorPhoto}>
              <CreatorAvatar name={creator.name} photo={creator.photo} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.creatorName}>{firstName}</Text>
              <Text style={styles.creatorRole}>Your creator</Text>
              <Text style={styles.creatorSub}>
                {step === 2
                  ? 'Delivered your edit — message them any time.'
                  : 'Working on your edit right now.'}
              </Text>
            </View>
          </View>
        )}

        {/* Order details */}
        <Text style={styles.sectionTitle}>Order details</Text>
        <View style={styles.detailsCard}>
          <DetailRow label="Package" value={booking?.mediaKind === 'video' ? 'Video edit' : booking?.mediaKind === 'both' ? 'Photo + video' : 'Photo edit'} />
          <DetailRow label="Style" value="Warm & golden" />
          <DetailRow label="Files uploaded" value="3" last />
        </View>

        {/* What happens next */}
        <Text style={styles.sectionTitle}>What happens next</Text>
        <View style={styles.nextCard}>
          <View style={styles.nextIcon}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path d="M12 3a6 6 0 00-6 6c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6a6 6 0 00-6-6z" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinejoin="round" />
              <Path d="M10 20a2 2 0 004 0" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.nextText}>
              We'll notify you the moment your edit is ready. You'll be able to preview everything in the
              app and download in full quality.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 }}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke="#8A8377" strokeWidth={1.8} />
                <Path d="M12 7.5V12l3 2" stroke="#8A8377" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={styles.nextEta}>Most orders finish ahead of schedule</Text>
            </View>
          </View>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        {step === 2 && (
          <>
            <Pressable onPress={() => router.push(`/order/${id}/delivery`)} style={styles.cta}>
              <Text style={styles.ctaLabel}>View & download</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
            <Pressable onPress={() => {}} style={styles.reviseBtn}>
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Path d="M4 12a8 8 0 018-8c2.8 0 5.2 1.4 6.6 3.6M20 12a8 8 0 01-8 8c-2.8 0-5.2-1.4-6.6-3.6M18 4.5v3.2h-3.2M6 19.5v-3.2h3.2" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={styles.reviseLabel}>Request a revision</Text>
              <Text style={styles.reviseCount}>{FREE_REVISIONS_PER_ORDER} free left</Text>
            </Pressable>
          </>
        )}
        {step < 2 && (
          <Pressable onPress={() => setStep((s) => Math.min(2, s + 1) as Step)} style={styles.advanceBtn}>
            <Text style={styles.advanceLabel}>Advance status (demo)</Text>
          </Pressable>
        )}
      </View>

      <Pressable onPress={() => setChatOpen(true)} style={styles.chatFab}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H10l-4.5 3.5V15H6a2 2 0 01-2-2V6z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
      </Pressable>

      <Modal visible={chatOpen} transparent animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setChatOpen(false)} />
          <View style={styles.chatSheet}>
            <View style={styles.chatHead}>
              {creator && (
                <View style={styles.chatAvatar}>
                  <CreatorAvatar name={creator.name} photo={creator.photo} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.chatName}>{firstName}</Text>
                <Text style={styles.chatRole}>Your creator</Text>
              </View>
              <Pressable onPress={() => setChatOpen(false)} style={styles.chatClose}>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>
            <View style={{ padding: 14, paddingHorizontal: 16 }}>
              <View style={styles.chatMsgRow}>
                {creator && (
                  <View style={styles.chatMsgAvatar}>
                    <CreatorAvatar name={creator.name} photo={creator.photo} />
                  </View>
                )}
                <View style={styles.chatBubbleThem}>
                  <Text style={styles.chatText}>
                    Got your files — I'll have a first cut over to you shortly. Any must-keep shots?
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <View style={styles.chatBubbleMe}>
                  <Text style={styles.chatText}>The sunset clips are the priority — thank you! 🙌</Text>
                </View>
              </View>
            </View>
            <View style={{ paddingHorizontal: 14, paddingBottom: 14, paddingTop: 4 }}>
              <View style={styles.chatInputRow}>
                <TextInput
                  placeholder={`Message ${firstName}…`}
                  placeholderTextColor="#9A9A9A"
                  style={styles.chatInput}
                />
                <View style={styles.chatSend}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M4 12L20 4l-6 16-3-7-7-1z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                  </Svg>
                </View>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, !last && { marginBottom: 10 }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  orderId: { fontSize: 12, color: colors.grey },
  eta: { fontSize: 13.5, fontWeight: '700', color: colors.ink, marginTop: 2 },
  reportChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  reportChipLabel: { fontSize: 10, fontWeight: '800', color: colors.yellowDark },
  stepperCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.yellow },
  dotIdle: { backgroundColor: '#EFEDE7' },
  innerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C6C3BC' },
  connector: { flex: 1, height: 3, backgroundColor: '#EFEDE7', marginHorizontal: 4, borderRadius: 2 },
  connectorDone: { backgroundColor: colors.yellow },
  stepLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  stepLabel: { fontSize: 11, fontWeight: '600', color: '#B4B1AA', width: 70 },
  stepLabelActive: { color: colors.ink, fontWeight: '800' },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  statusDesc: { fontSize: 13, color: colors.grey, marginTop: 3, lineHeight: 18 },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 9,
  },
  timeChipLabel: { fontSize: 9.5, fontWeight: '800', color: '#8A6800' },
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
  creatorSub: { fontSize: 12.5, color: colors.grey, marginTop: 6, lineHeight: 17 },
  sectionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 22, marginBottom: 12 },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    paddingHorizontal: 18,
    shadowColor: colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailLabel: { fontSize: 13.5, color: colors.grey },
  detailValue: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    paddingHorizontal: 18,
    shadowColor: colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  nextIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { fontSize: 13.5, color: '#5C574E', lineHeight: 20 },
  nextEta: { fontSize: 12, fontWeight: '700', color: '#8A7530' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 10,
  },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  reviseBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E3DA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  reviseLabel: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
  reviseCount: { fontSize: 9.5, fontWeight: '800', color: colors.greyWarm },
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
    bottom: 120,
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
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  chatSheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 14,
  },
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
  chatMsgRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-end', marginBottom: 12 },
  chatMsgAvatar: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  chatBubbleThem: {
    maxWidth: '82%',
    backgroundColor: colors.segBgAlt,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    padding: 10,
    paddingHorizontal: 13,
  },
  chatBubbleMe: {
    maxWidth: '82%',
    backgroundColor: colors.yellow,
    borderRadius: 14,
    borderBottomRightRadius: 4,
    padding: 10,
    paddingHorizontal: 13,
  },
  chatText: { fontSize: 13, lineHeight: 18, color: colors.ink },
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
