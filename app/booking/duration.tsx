import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { DURATIONS, MediaKind } from '../../lib/mock/data';
import { useAuth, useBookings } from '../../lib/store';
import { formatMoney, OCCASION_DEFAULT_DURATION_HOURS } from '../../lib/constants/business';
import { colors, spacing } from '../../lib/theme';

const PKG_DESC: Record<MediaKind, string> = {
  photo: 'Edited, color-graded photos delivered in the app.',
  video: 'A polished highlight video cut by a Snapt editor.',
  both: 'Photos plus a highlight video — our full coverage package.',
};

export default function DurationAndPackage() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { draft, setDraft } = useBookings();

  // Occasion-based smart default — pre-selected, fully overridable (§7).
  const recommendedHours = draft.occasion
    ? OCCASION_DEFAULT_DURATION_HOURS[draft.occasion]
    : undefined;

  React.useEffect(() => {
    if (draft.durationHours == null && recommendedHours != null) {
      setDraft({ durationHours: recommendedHours });
    }
  }, []);

  const selected = DURATIONS.find((d) => d.hours === draft.durationHours);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Duration & package" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>Pick how long you need your creator.</Text>
        <Text style={styles.sectionLabel}>What do you need?</Text>
        <SegmentedControl
          options={[
            { value: 'photo', label: 'Photos' },
            { value: 'video', label: 'Video' },
            { value: 'both', label: 'Both' },
          ]}
          value={draft.mediaKind}
          onChange={(mediaKind) => setDraft({ mediaKind })}
        />
        <Text style={styles.pkgDesc}>{PKG_DESC[draft.mediaKind]}</Text>

        <Text style={[styles.sectionLabel, { marginTop: 24, marginBottom: 4 }]}>
          Session length
        </Text>
        <Text style={styles.hint}>
          All sessions are scheduled in advance — no same-day booking yet.
        </Text>
        <View style={{ gap: 10 }}>
          {DURATIONS.map((d) => {
            const active = draft.durationHours === d.hours;
            const rec = recommendedHours === d.hours;
            return (
              <Pressable
                key={d.hours}
                onPress={() => setDraft({ durationHours: d.hours })}
                style={[styles.row, active && styles.rowActive]}
              >
                <View style={[styles.radio, active && styles.radioActive]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleWrap}>
                    <Text style={styles.rowTitle}>{d.label}</Text>
                    {d.popular && (
                      <View style={styles.popBadge}>
                        <Text style={styles.popBadgeLabel}>MOST POPULAR</Text>
                      </View>
                    )}
                    {rec && draft.occasion && (
                      <View style={styles.recBadge}>
                        <Text style={styles.recBadgeLabel}>
                          Recommended for {draft.occasion}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowDeliv}>{d.deliverables}</Text>
                </View>
                <Text style={styles.rowPrice}>{formatMoney(d.priceUsd, currency)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <View>
          <Text style={styles.footMetaLabel}>session</Text>
          <Text style={styles.footMetaValue}>
            {selected ? formatMoney(selected.priceUsd, currency) : '—'}
          </Text>
        </View>
        <Button
          title="Continue"
          arrow
          disabled={!selected}
          onPress={() => router.push('/booking/location')}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  lead: { fontSize: 13.5, color: colors.grey, lineHeight: 19.5, marginBottom: 16 },
  sectionLabel: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginBottom: 12 },
  pkgDesc: { fontSize: 12.5, color: colors.grey, lineHeight: 18, marginTop: 10, paddingHorizontal: 2 },
  hint: { fontSize: 12, color: colors.grey, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 15,
  },
  rowActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.greyLight },
  radioActive: { borderWidth: 6, borderColor: colors.yellow },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  popBadge: { backgroundColor: colors.yellowTint, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  popBadgeLabel: { fontSize: 9, fontWeight: '800', color: colors.goldText, letterSpacing: 0.4 },
  recBadge: { backgroundColor: colors.yellow, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  recBadgeLabel: { fontSize: 9, fontWeight: '800', color: colors.ink, letterSpacing: 0.3 },
  rowDeliv: { fontSize: 12, color: colors.grey, marginTop: 4 },
  rowPrice: { fontSize: 15, fontWeight: '800', color: colors.ink },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  footMetaLabel: { fontSize: 11, color: colors.grey },
  footMetaValue: { fontSize: 17, fontWeight: '800', color: colors.ink },
});
