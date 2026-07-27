import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { OccasionIcon } from '../../components/ui/Icons';
import { OCCASIONS, Occasion } from '../../lib/mock/data';
import { useAuth } from '../../lib/store';
import { useCreator } from '../../lib/store/creator';
import { colors } from '../../lib/theme';

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
  const { setCreatorStatus } = useAuth();
  const { setSpecialties } = useCreator();
  const [portfolio, setPortfolio] = React.useState('');
  const [sel, setSel] = React.useState<Occasion[]>([]);
  // Two separate consents per handoff §14: Creator Agreement acceptance is
  // its own step, alongside (not merged with) background-check consent.
  const [agreementAccepted, setAgreementAccepted] = React.useState(false);
  const [bgCheckConsent, setBgCheckConsent] = React.useState(false);

  const canSubmit = sel.length > 0 && agreementAccepted && bgCheckConsent;

  const toggle = (o: Occasion) =>
    setSel((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Become a Creator" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Tell us what you shoot and we'll take it from there. Applications are vetted — most hear back
          in 2–3 days.
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

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>SPECIALTIES (PICK AT LEAST 1)</Text>
        <View style={styles.chipWrap}>
          {OCCASIONS.map((o) => {
            const active = sel.includes(o);
            return (
              <Pressable key={o} onPress={() => toggle(o)} style={[styles.chip, active && styles.chipActive]}>
                <OccasionIcon occasion={o} size={17} />
                <Text style={[styles.chipLabel, active && { color: '#fff' }]}>{o}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.chipNote}>
          You'll only be offered jobs for occasions you select — you can edit these any time.
        </Text>

        <Text style={[styles.sectionLabel, { marginTop: 22 }]}>AGREEMENTS</Text>
        <View style={styles.consentCard}>
          <Pressable onPress={() => setAgreementAccepted(!agreementAccepted)} style={styles.consentRow}>
            <Check on={agreementAccepted} />
            <Text style={styles.consentText}>
              I've read and accept the{' '}
              <Text onPress={() => router.push('/legal/creator-agreement')} style={styles.link}>
                Creator Agreement
              </Text>
              , including the reliability standards and payout terms.
            </Text>
          </Pressable>
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
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Submit application"
          disabled={!canSubmit}
          onPress={() => {
            setSpecialties(sel);
            setCreatorStatus('review');
            router.back();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  lead: { fontSize: 14, color: colors.grey, lineHeight: 20, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.greyWarm, letterSpacing: 0.5, marginBottom: 8, marginHorizontal: 2 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#E7E7E7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 14.5,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  chipNote: { fontSize: 11.5, color: '#9A948B', lineHeight: 16, marginTop: 10, marginHorizontal: 2 },
  consentCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  consentDiv: { height: 1, backgroundColor: '#F1F1F1', marginLeft: 50 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#D8D2C4',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  consentText: { flex: 1, fontSize: 12.5, color: '#3D3A34', lineHeight: 19 },
  link: { color: colors.yellowDark, fontWeight: '700', textDecorationLine: 'underline' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
});
