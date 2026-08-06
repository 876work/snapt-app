import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { VerifyIdentity } from '../../components/creator/VerifyIdentity';
import { PoliceCertificate } from '../../components/creator/PoliceCertificate';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { OccasionIcon } from '../../components/ui/Icons';
import { AREAS, Area, OCCASIONS, Occasion } from '../../lib/mock/data';
import { useAuth } from '../../lib/store';
import { useCreator } from '../../lib/store/creator';
import { colors, insetBottom } from '../../lib/theme';

// Creator application (§12/§14). Branches on service type: background-check
// consent applies only to in-person work, never Remote. Progress autosaves
// as a server-side draft so applicants resume where they left off; every
// field is re-validated server-side on submit.

type ServiceType = 'remote' | 'in_person' | 'both';

function Check({ on }: { on: boolean }) {
  return (
    <View style={[styles.checkbox, on && styles.checkboxOn]}>
      {on && (
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <Path d="M5 12.5l4 4L19 7" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
    </View>
  );
}

export default function CreatorApplication() {
  const router = useRouter();
  const { setCreatorStatus, creatorStatus } = useAuth();
  const { setSpecialties } = useCreator();
  const [serviceType, setServiceType] = React.useState<ServiceType>('both');
  const [portfolio, setPortfolio] = React.useState('');
  const [legalName, setLegalName] = React.useState('');
  const [sel, setSel] = React.useState<Occasion[]>([]);
  const [baseArea, setBaseArea] = React.useState<Area | null>(null);
  const [areaOpen, setAreaOpen] = React.useState(false);
  const [agreementAccepted, setAgreementAccepted] = React.useState(false);
  const [bgCheckConsent, setBgCheckConsent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const loaded = React.useRef(false);

  const needsBgCheck = serviceType !== 'remote';
  const canSubmit =
    sel.length > 0 &&
    legalName.trim().length >= 3 &&
    agreementAccepted &&
    (!needsBgCheck || (bgCheckConsent && baseArea != null)) &&
    !busy;

  // Resume a saved draft (server-side) once on mount.
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) {
        loaded.current = true;
        return;
      }
      fetchCreatorMe().then((me) => {
        if (me && me.status === 'in_progress') {
          if (me.specialties?.length) setSel(me.specialties as Occasion[]);
          if (me.service_type) setServiceType(me.service_type);
          if (me.base_area) setBaseArea(me.base_area as Area);
        }
        loaded.current = true;
      });
    });
  }, []);

  // Autosave the draft (debounced) so users can leave and resume.
  React.useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      import('../../lib/api').then(({ apiConfigured, saveCreatorDraftApi }) => {
        if (!apiConfigured) return;
        saveCreatorDraftApi({
          specialties: sel,
          service_type: serviceType,
          base_area: baseArea ?? undefined,
        }).then((r) => {
          if (r && !('error' in r) && creatorStatus === 'not_applied') {
            setCreatorStatus('in_progress');
          }
        });
      });
    }, 800);
    return () => clearTimeout(t);
  }, [sel, serviceType, baseArea, creatorStatus, setCreatorStatus]);

  // Flush the draft on unmount so backing out inside the debounce window
  // never loses the last edit (the resume-where-you-left-off guarantee).
  const latest = React.useRef({ sel, serviceType, baseArea });
  latest.current = { sel, serviceType, baseArea };
  React.useEffect(() => {
    return () => {
      if (!loaded.current) return;
      import('../../lib/api').then(({ apiConfigured, saveCreatorDraftApi }) => {
        if (!apiConfigured) return;
        const v = latest.current;
        saveCreatorDraftApi({
          specialties: v.sel,
          service_type: v.serviceType,
          base_area: v.baseArea ?? undefined,
        });
      });
    };
  }, []);

  const toggle = (o: Occasion) =>
    setSel((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const api = await import('../../lib/api');
    if (api.apiConfigured) {
      const result = await api.applyAsCreator({
        specialties: sel,
        service_type: serviceType,
        base_area: baseArea,
        declared_legal_name: legalName.trim(),
        consents: {
          creator_agreement: true,
          ...(needsBgCheck ? { background_check: true } : {}),
        },
      });
      setBusy(false);
      if (result && 'error' in result) {
        if (!result.error.includes('already')) {
          setError(result.error);
          return;
        }
      }
    } else {
      setBusy(false);
    }
    setSpecialties(sel);
    setCreatorStatus('pending_review');
    // The status screen is the designed landing after submitting.
    router.replace('/creator/pending');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Become a Creator" backFallback="/(app)/profile" />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Tell us what you shoot and we'll take it from there. Applications are vetted — most hear back
          in 2–3 days. Your progress saves automatically.
        </Text>

        <Text style={styles.sectionLabel}>HOW DO YOU WANT TO WORK?</Text>
        <SegmentedControl
          options={[
            { value: 'in_person', label: 'In person' },
            { value: 'remote', label: 'Remote edit' },
            { value: 'both', label: 'Both' },
          ]}
          value={serviceType}
          onChange={setServiceType}
        />
        <Text style={styles.hint}>
          {serviceType === 'remote'
            ? 'Edit footage clients send in — no shoots, no background check needed.'
            : 'In-person sessions require a background check before you go live.'}
        </Text>

        <Text style={styles.sectionLabel}>FULL LEGAL NAME</Text>
        <TextInput
          value={legalName}
          onChangeText={setLegalName}
          placeholder="Exactly as printed on your ID"
          placeholderTextColor="#9A9A9A"
          autoCapitalize="words"
          autoComplete="name"
          style={styles.input}
        />
        <Text style={styles.hint}>
          We check this against your ID. It's used for payouts and our records only — clients
          always see your profile name, and this never changes it.
        </Text>

        <Text style={styles.sectionLabel}>PORTFOLIO LINK</Text>
        <TextInput
          value={portfolio}
          onChangeText={setPortfolio}
          placeholder="Instagram, website, or drive folder"
          placeholderTextColor="#9A9A9A"
          autoCapitalize="none"
          style={styles.input}
        />

        <Text style={styles.sectionLabel}>SPECIALTIES — PICK AT LEAST ONE</Text>
        <View style={styles.chipWrap}>
          {OCCASIONS.map((o) => {
            const active = sel.includes(o);
            return (
              <Pressable key={o} onPress={() => toggle(o)} style={[styles.chip, active && styles.chipActive]}>
                <OccasionIcon occasion={o} />
                <Text style={styles.chipLabel}>{o}</Text>
              </Pressable>
            );
          })}
        </View>

        {needsBgCheck && (
          <>
            <Text style={styles.sectionLabel}>BASE AREA</Text>
            <Pressable onPress={() => setAreaOpen(!areaOpen)} style={styles.input}>
              <Text style={{ fontSize: 14, color: baseArea ? colors.ink : '#9A9A9A', fontWeight: baseArea ? '700' : '400' }}>
                {baseArea ?? 'Where are you based?'}
              </Text>
            </Pressable>
            {areaOpen && (
              <View style={styles.areaList}>
                {AREAS.map((a) => (
                  <Pressable
                    key={a}
                    onPress={() => {
                      setBaseArea(a);
                      setAreaOpen(false);
                    }}
                    style={styles.areaItem}
                  >
                    <Text style={[styles.areaItemLabel, a === baseArea && { color: colors.yellowDark, fontWeight: '800' }]}>
                      {a}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        {needsBgCheck && (
          <>
            <Text style={styles.sectionLabel}>IDENTITY</Text>
            <VerifyIdentity />
            <Text style={styles.sectionLabel}>POLICE CERTIFICATE</Text>
            <PoliceCertificate />
          </>
        )}

        <Text style={styles.sectionLabel}>CONSENTS</Text>
        <View style={styles.consentCard}>
          <Pressable onPress={() => setAgreementAccepted(!agreementAccepted)} style={styles.consentRow}>
            <Check on={agreementAccepted} />
            <Text style={styles.consentText}>
              I have read and agree to the{' '}
              <Text onPress={() => router.push('/legal/creator-agreement')} style={styles.link}>
                Creator Agreement
              </Text>
              , including the standardized pricing and payout terms.
            </Text>
          </Pressable>
          {needsBgCheck && (
            <>
              <View style={styles.consentDiv} />
              <Pressable onPress={() => setBgCheckConsent(!bgCheckConsent)} style={styles.consentRow}>
                <Check on={bgCheckConsent} />
                <Text style={styles.consentText}>
                  I consent to a background check as described in the{' '}
                  <Text onPress={() => router.push('/legal/background-check')} style={styles.link}>
                    Background Check & Vetting Disclosure
                  </Text>
                  .
                </Text>
              </Pressable>
            </>
          )}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={{ height: 24 }} />
      </KeyboardScrollView>
      <View style={styles.footer}>
        <Button
          title={busy ? 'Submitting…' : 'Submit application'}
          arrow
          disabled={!canSubmit}
          onPress={submit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  lead: { fontSize: 13.5, color: colors.grey, lineHeight: 19.5, marginBottom: 8 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.yellowDark,
    marginTop: 20,
    marginBottom: 9,
  },
  hint: { fontSize: 11.5, color: colors.greyWarm, lineHeight: 16, marginTop: 8 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#E7E7E7',
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  chipLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  areaList: {
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 14,
    marginTop: 6,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  areaItem: { paddingVertical: 12, paddingHorizontal: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  areaItemLabel: { fontSize: 13, fontWeight: '600', color: colors.ink },
  consentCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFEDE7',
  },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  consentDiv: { height: 1, backgroundColor: '#F1F1F1', marginLeft: 50 },
  consentText: { flex: 1, fontSize: 12.5, color: colors.grey, lineHeight: 18.5 },
  link: { fontSize: 12.5, fontWeight: '800', color: colors.yellowDark },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.greyLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  error: { fontSize: 12.5, color: colors.error, fontWeight: '600', marginTop: 12 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
});
