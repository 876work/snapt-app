import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { OccasionIcon } from '../../components/ui/Icons';
import { OCCASIONS, Occasion } from '../../lib/mock/data';
import { useCreator } from '../../lib/store/creator';
import { colors, insetBottom } from '../../lib/theme';

// Specialties are a hard matching filter (§12): clients booking an occasion
// you haven't selected will never see you. At least one is required.
export default function Specialties() {
  const router = useRouter();
  const { specialties, setSpecialties } = useCreator();
  const [sel, setSel] = React.useState<Occasion[]>(specialties);

  const toggle = (o: Occasion) =>
    setSel((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Specialties" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Pick the occasions you shoot. You'll only be matched with bookings for occasions you select —
          this is a hard filter, not a preference.
        </Text>
        <View style={{ gap: 10 }}>
          {OCCASIONS.map((o) => {
            const active = sel.includes(o);
            return (
              <Pressable key={o} onPress={() => toggle(o)} style={[styles.row, active && styles.rowActive]}>
                <OccasionIcon occasion={o} size={22} />
                <Text style={styles.rowLabel}>{o}</Text>
                <View style={[styles.check, active && styles.checkOn]}>
                  {active && (
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 13l4 4L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
        {sel.length === 0 && (
          <Text style={styles.error}>Select at least one specialty to stay matchable.</Text>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Save specialties"
          disabled={sel.length === 0}
          onPress={() => {
            setSpecialties(sel);
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
  lead: { fontSize: 13.5, color: colors.grey, lineHeight: 20, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 15,
  },
  rowActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D8D2C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  error: { fontSize: 12, color: colors.error, fontWeight: '600', marginTop: 14 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
});
