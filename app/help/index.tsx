import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Misc';
import { colors, spacing } from '../../lib/theme';

const FAQS = [
  'How do bookings work?',
  'What happens if my creator cancels?',
  'When do I get my photos?',
  'How do refunds work?',
];

export default function Help() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScreenHeader title="Help & Support" />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={{ paddingVertical: 4, paddingHorizontal: 0 }}>
          {FAQS.map((q, i) => (
            <View key={q} style={[styles.row, i < FAQS.length - 1 && styles.rowBorder]}>
              <Text style={styles.rowLabel}>{q}</Text>
              <Svg width={8} height={14} viewBox="0 0 8 14">
                <Path d="M1 1l6 6-6 6" stroke={colors.greyLight} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          ))}
        </Card>
        <Text style={styles.faqNote}>Real FAQ copy lands before launch (Phase 7).</Text>
        <View style={{ gap: 10, marginTop: 18 }}>
          <Pressable onPress={() => router.push('/help/contact')} style={styles.cta}>
            <Text style={styles.ctaLabel}>Contact support</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/help/report')} style={[styles.cta, styles.ctaGhost]}>
            <Text style={[styles.ctaLabel, { color: colors.ink }]}>Report a problem</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  faqNote: { fontSize: 11.5, color: colors.greyLight, marginTop: 10, textAlign: 'center' },
  cta: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
