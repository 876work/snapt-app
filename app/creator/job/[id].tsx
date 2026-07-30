import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Button } from '../../../components/ui/Button';
import { SlideToConfirm } from '../../../components/ui/SlideToConfirm';
import { useAuth } from '../../../lib/store';
import { useCreator, JobStage } from '../../../lib/store/creator';
import { formatMoney, NO_SHOW_GRACE_MINUTES } from '../../../lib/constants/business';
import { colors, insetBottom } from '../../../lib/theme';

// Creator job flow: offer → accepted → on the way → check-in (safety code)
// → session in progress → footage upload → submitted.
const STAGE_TITLES: Record<JobStage, string> = {
  offer: 'Job offer',
  accepted: 'Job accepted',
  onway: 'On the way',
  checkin: 'Check in',
  session: 'Session in progress',
  upload: 'Upload footage',
  submitted: 'Footage submitted',
};

export default function CreatorJob() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useAuth((s) => s.currency);
  const { offers, jobStages, setStage } = useCreator();
  const job = offers.find((o) => o.id === id);
  const stage: JobStage = jobStages[String(id)] ?? 'offer';
  const [code, setCode] = React.useState('');
  const [contactConfirmed, setContactConfirmed] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<{ uri: string; name: string; mimeType?: string }[]>([]);

  if (!job) return null;
  const next = (s: JobStage) => setStage(job.id, s);

  // Real endpoint calls in API mode (Phase 3 session/media pipeline);
  // mock stage machine otherwise.
  const withApi = async (fn: (api: typeof import('../../../lib/api')) => Promise<boolean>) => {
    const api = await import('../../../lib/api');
    setActionError(null);
    if (!api.apiConfigured) return true;
    return fn(api);
  };

  const acceptJob = () =>
    withApi(async (api) => {
      const r = await api.acceptBookingApi(job.id);
      if (r && 'error' in r) {
        setActionError(r.error); // offer expired/reassigned
        return false;
      }
      return true;
    }).then((ok) => ok && next('accepted'));

  const arriveCheckIn = () =>
    withApi(async (api) => {
      const r = await api.checkInApi(job.id);
      if (r && 'error' in r) {
        setActionError(r.error);
        return false;
      }
      return true;
    }).then((ok) => ok && next('checkin'));

  const verifyAndStart = () =>
    withApi(async (api) => {
      const r = await api.verifySafetyCodeApi(job.id, code);
      if (r && 'error' in r) {
        setActionError(r.error); // wrong code
        return false;
      }
      return true;
    }).then((ok) => ok && next('session'));

  const pickFootage = async () => {
    const api = await import('../../../lib/api');
    if (!api.apiConfigured) return; // dropzone is illustrative in mock mode
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, quality: 1 });
    if (result.canceled) return;
    setPicked((prev) => [
      ...prev,
      ...result.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `footage-${Date.now()}-${i}.jpg`,
        mimeType: a.mimeType ?? undefined,
      })),
    ]);
  };

  // Open revision round (API mode): shown in the submitted stage; re-uses
  // the same pick → upload deliverable → mark delivered pattern.
  const [openRevision, setOpenRevision] = React.useState<{ id: string; details: string } | null>(null);
  React.useEffect(() => {
    if (stage !== 'submitted') return;
    import('../../../lib/api').then(({ apiConfigured, fetchRevisionsApi }) => {
      if (!apiConfigured) return;
      fetchRevisionsApi(String(id)).then((revs) => {
        const open = revs?.find((r) => r.status === 'open');
        setOpenRevision(open ? { id: open.id, details: open.details } : null);
      });
    });
  }, [stage]);

  const deliverRevision = () =>
    withApi(async (api) => {
      if (!openRevision) return false;
      if (picked.length === 0) {
        setActionError('Pick the updated files first.');
        return false;
      }
      for (const file of picked) {
        const ok = await api.uploadMediaApi(job.id, 'deliverable', file);
        if (!ok) {
          setActionError('Upload failed — try again.');
          return false;
        }
      }
      const r = await api.deliverRevisionApi(job.id, openRevision.id);
      if (r && 'error' in r) {
        setActionError(r.error);
        return false;
      }
      setOpenRevision(null);
      setPicked([]);
      return true;
    });

  const submitFootage = () =>
    withApi(async (api) => {
      // In-person: raw footage upload + session completion (payout trigger).
      // Remote-edit jobs: the upload is the DELIVERABLE, then deliver.
      const kind = job.type === 'remote' ? 'deliverable' : 'raw';
      if (picked.length === 0) {
        setActionError('Pick at least one file from today first.');
        return false;
      }
      for (const file of picked) {
        const ok = await api.uploadMediaApi(job.id, kind, file);
        if (!ok) {
          setActionError('Upload failed — check your connection and try again.');
          return false;
        }
      }
      const r = job.type === 'remote' ? await api.deliverApi(job.id) : await api.completeSessionApi(job.id);
      if (r && 'error' in r) {
        setActionError(r.error);
        return false;
      }
      return true;
    }).then((ok) => ok && next('submitted'));

  return (
    <View style={styles.root}>
      <ScreenHeader title={STAGE_TITLES[stage]} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Job summary card */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ minWidth: 0 }}>
              <Text style={styles.jobTitle}>{job.title}</Text>
              <Text style={styles.jobOccasion}>{job.occasion}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.pay}>{formatMoney(job.payUsd, currency)}</Text>
              <Text style={styles.paySub}>your take after fees</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.grey} strokeWidth={1.8} />
              <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
            <Text style={styles.metaLabel}>{job.when}</Text>
          </View>
          <View style={styles.metaRow}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
              <Circle cx="12" cy="10" r="2.3" stroke={colors.grey} strokeWidth={1.8} />
            </Svg>
            <Text style={styles.metaLabel}>{job.loc}</Text>
          </View>
        </View>

        {stage === 'offer' && (
          <>
            <View style={styles.noteCard}>
              <Text style={styles.noteTitle}>Client note</Text>
              <Text style={styles.noteBody}>
                "Golden hour is a must — we'd love candid shots by the water. Two of us, casual outfits."
              </Text>
            </View>
            <View style={styles.warnCard}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ marginTop: 1 }}>
                <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.8} />
                <Path d="M12 11v5" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
                <Circle cx="12" cy="8" r="1.1" fill={colors.yellowDark} />
              </Svg>
              <Text style={styles.warnText}>
                Accepting commits you to this session. Late cancellations count double toward your
                reliability standing.
              </Text>
            </View>
          </>
        )}

        {stage === 'accepted' && (
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={styles.successTitle}>You're booked!</Text>
            <Text style={styles.successSub}>
              The client has been notified. It's on your schedule — head out in time on the day.
            </Text>
          </View>
        )}

        {stage === 'onway' && (
          <View style={styles.map}>
            <View style={styles.mapLegend}>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: colors.ink }]} />
                <Text style={styles.legendLabel}>You</Text>
              </View>
              <View style={[styles.legendRow, { marginTop: 3 }]}>
                <View style={[styles.legendDot, { backgroundColor: colors.yellow, borderWidth: 1.5, borderColor: colors.ink }]} />
                <Text style={styles.legendLabel}>Meeting point</Text>
              </View>
            </View>
          </View>
        )}

        {stage === 'checkin' && (
          <>
            <Text style={styles.checkinLead}>
              Ask the client for their 4-digit safety code to start the session.
            </Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="• • • •"
              placeholderTextColor="#C6C3BC"
              keyboardType="number-pad"
              maxLength={4}
              style={styles.codeInput}
            />
            {/* Creator-side no-show: attempted-contact confirmation gates the
                report, then slide-to-confirm (handoff §8) */}
            <View style={styles.graceCard}>
              <Text style={styles.graceTitle}>Client not here?</Text>
              <Text style={styles.graceNote}>
                A {NO_SHOW_GRACE_MINUTES}-minute grace period applies. Before reporting a no-show, confirm
                you've tried to reach them.
              </Text>
              <Pressable onPress={() => setContactConfirmed(!contactConfirmed)} style={styles.contactRow}>
                <View style={[styles.checkbox, contactConfirmed && styles.checkboxOn]}>
                  {contactConfirmed && (
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12.5l4 4L19 7" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
                <Text style={styles.contactLabel}>I've called and messaged the client</Text>
              </Pressable>
              {contactConfirmed && (
                <View style={{ marginTop: 12 }}>
                  <SlideToConfirm
                    label="Slide to report client no-show"
                    danger
                    onConfirm={() => {
                      next('submitted');
                      router.back();
                    }}
                  />
                </View>
              )}
            </View>
          </>
        )}

        {stage === 'session' && (
          <View style={styles.successCard}>
            <View style={[styles.successIcon, { backgroundColor: '#EAF8F0' }]}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Rect x="3" y="6.5" width="18" height="13" rx="3" stroke="#1B9A57" strokeWidth={1.8} />
                <Circle cx="12" cy="13" r="3.3" stroke="#1B9A57" strokeWidth={1.8} />
              </Svg>
            </View>
            <Text style={styles.successTitle}>Session active</Text>
            <Text style={styles.successSub}>
              Code verified. Do your thing — wrap the session here when you're done shooting.
            </Text>
          </View>
        )}

        {stage === 'upload' && (
          <>
            <Text style={styles.checkinLead}>
              Upload the raw footage from today's session. The client never sees raws — they go straight
              to editing.
            </Text>
            <Pressable onPress={pickFootage} style={styles.dropzone}>
              <View style={styles.dropIcon}>
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <Path d="M5 15v3a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 18v-3" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </View>
              <Text style={styles.dropTitle}>
                {picked.length > 0 ? `${picked.length} file${picked.length > 1 ? 's' : ''} ready` : 'Add session footage'}
              </Text>
              <Text style={styles.dropSub}>RAW, JPG, MP4, MOV — everything from today</Text>
            </Pressable>
          </>
        )}

        {stage === 'submitted' && openRevision && (
          <>
            <Text style={styles.checkinLead}>
              Revision requested — the client asked for changes:
            </Text>
            <View style={styles.card}>
              <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>{openRevision.details}</Text>
            </View>
            <Pressable onPress={pickFootage} style={styles.dropzone}>
              <Text style={styles.dropTitle}>
                {picked.length > 0 ? `${picked.length} updated file${picked.length > 1 ? 's' : ''} ready` : 'Add the updated files'}
              </Text>
              <Text style={styles.dropSub}>Same delivery flow — upload, then mark the revision delivered</Text>
            </Pressable>
          </>
        )}
        {stage === 'submitted' && !openRevision && (
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={styles.successTitle}>Footage submitted</Text>
            <Text style={styles.successSub}>
              Editing takes it from here. Your payout lands in Earnings once the client's review window
              closes.
            </Text>
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        {stage === 'offer' && (
          <SlideToConfirm label="Slide to accept this job" onConfirm={acceptJob} />
        )}
        {stage === 'accepted' && (
          <Button title="I'm on my way" arrow onPress={() => next('onway')} />
        )}
        {stage === 'onway' && (
          <Button title="I've arrived — check in" arrow onPress={arriveCheckIn} />
        )}
        {stage === 'checkin' && (
          <Button
            title="Verify code & start session"
            disabled={code.length !== 4}
            onPress={verifyAndStart}
          />
        )}
        {stage === 'session' && (
          <Button title="Wrap session — upload footage" arrow onPress={() => next('upload')} />
        )}
        {stage === 'upload' && (
          <Button title="Submit footage" onPress={submitFootage} />
        )}
        {stage === 'submitted' && openRevision && (
          <Button title="Deliver revision" onPress={deliverRevision} />
        )}
        {stage === 'submitted' && !openRevision && (
          <Button title="Back to jobs" variant="ghost" onPress={() => router.back()} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  jobTitle: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  jobOccasion: { fontSize: 11, color: colors.greyWarm, marginTop: 2 },
  pay: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  paySub: { fontSize: 10.5, color: colors.grey, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  metaLabel: { fontSize: 11.5, color: colors.greyWarm },
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  noteTitle: { fontSize: 10, fontWeight: '800', color: colors.yellowDark, letterSpacing: 0.5, textTransform: 'uppercase' },
  noteBody: { fontSize: 13, color: '#3D3A34', lineHeight: 20, marginTop: 8 },
  warnCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 14,
    padding: 13,
    marginTop: 14,
  },
  warnText: { flex: 1, fontSize: 11.5, color: '#8A6800', lineHeight: 17, fontWeight: '600' },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  successTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  successSub: { fontSize: 13, color: colors.grey, marginTop: 8, lineHeight: 19, textAlign: 'center' },
  map: { height: 210, borderRadius: 16, backgroundColor: '#E5E2DB', marginTop: 14, overflow: 'hidden' },
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
  checkinLead: { fontSize: 14, color: colors.grey, lineHeight: 20, marginTop: 16 },
  codeInput: {
    height: 74,
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    borderRadius: 18,
    backgroundColor: '#fff',
    textAlign: 'center',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 14,
    color: colors.ink,
    marginTop: 14,
  },
  graceCard: {
    backgroundColor: '#FFF9EC',
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 16,
    padding: 15,
    marginTop: 16,
  },
  graceTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  graceNote: { fontSize: 12, color: colors.grey, lineHeight: 18, marginTop: 6 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#D8D2C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  contactLabel: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.ink },
  dropzone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E2C97A',
    backgroundColor: '#FFFBF0',
    borderRadius: 16,
    paddingVertical: 26,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  dropIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  dropSub: { fontSize: 12, color: '#8A7530' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  actionError: { fontSize: 12.5, color: colors.error, fontWeight: '600', marginBottom: 10 },
});
