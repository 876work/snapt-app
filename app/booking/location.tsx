import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { InfoBanner } from '../../components/ui/Misc';
import { AREAS } from '../../lib/mock/data';
import { useBookings } from '../../lib/store';
import { colors, spacing } from '../../lib/theme';

export default function Location() {
  const router = useRouter();
  const { draft, setDraft } = useBookings();
  const [query, setQuery] = React.useState(draft.meetingPoint);

  // Area snapping is simulated: matching text against known service areas.
  // Real geocoding + polygon check is Phase 1 backend work.
  const matchedArea = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return AREAS.find((a) => a.toLowerCase().includes(q) || q.includes(a.toLowerCase())) ?? null;
  }, [query]);
  const outside = query.trim().length > 3 && !matchedArea && !draft.area;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Where should we meet you?" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.searchRow}>
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
            <Circle cx="11" cy="11" r="7" stroke={colors.grey} strokeWidth={1.8} />
            <Path d="M16 16l4 4" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
          <TextInput
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setDraft({ meetingPoint: t });
            }}
            placeholder="Search for an address in your service area."
            placeholderTextColor="#9A9A9A"
            style={styles.searchInput}
          />
        </View>

        {(matchedArea || draft.area) && (
          <View style={styles.snapRow}>
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"
                stroke={colors.yellowDark}
                strokeWidth={1.8}
                strokeLinejoin="round"
              />
              <Circle cx="12" cy="10" r="2.3" stroke={colors.yellowDark} strokeWidth={1.8} />
            </Svg>
            <Text style={styles.snapLabel}>
              You've selected:{' '}
              <Text style={{ color: colors.yellowDark }}>{matchedArea ?? draft.area}</Text>
            </Text>
          </View>
        )}

        {outside && (
          <View style={{ marginTop: 12 }}>
            <InfoBanner
              tone="error"
              text="This location is outside our current service area. Please choose a location within the highlighted zone."
            />
          </View>
        )}

        <View style={styles.svcRow}>
          <Text style={styles.svcText}>We currently serve select areas nearby. More areas coming soon.</Text>
        </View>

        <Text style={styles.sectionLabel}>Or pick a service area</Text>
        <View style={styles.areaWrap}>
          {AREAS.map((a) => {
            const active = draft.area === a;
            return (
              <Pressable
                key={a}
                onPress={() => setDraft({ area: a })}
                style={[styles.areaChip, active && styles.areaChipActive]}
              >
                <Text style={[styles.areaChipLabel, active && { color: colors.ink }]}>{a}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Map placeholder — Google Maps needs a production key (§2) */}
        <View style={styles.map}>
          <View style={styles.mapLegend}>
            <View style={styles.legendRow}>
              <View style={styles.legendSwatchIn} />
              <Text style={styles.legendLabel}>Service area</Text>
            </View>
            <View style={[styles.legendRow, { marginTop: 3 }]}>
              <View style={styles.legendSwatchOut} />
              <Text style={styles.legendLabel}>Outside service area</Text>
            </View>
          </View>
          <Text style={styles.mapNote}>Map preview — production Maps key pending</Text>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Continue"
          arrow
          disabled={!draft.area && !matchedArea}
          onPress={() => {
            if (!draft.area && matchedArea) setDraft({ area: matchedArea });
            router.push('/booking/creator');
          }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink },
  snapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 12,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 12,
    padding: 12,
  },
  snapLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  svcRow: {
    marginTop: 14,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: '#F4E7C0',
    borderRadius: 12,
    padding: 12,
  },
  svcText: { fontSize: 12, color: colors.goldText, lineHeight: 17.5, fontWeight: '500' },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: colors.ink,
    marginTop: 22,
    marginBottom: 12,
  },
  areaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  areaChip: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  areaChipActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  areaChipLabel: { fontSize: 12.5, fontWeight: '700', color: colors.grey },
  map: {
    height: 240,
    borderRadius: 16,
    backgroundColor: '#E5E2DB',
    marginTop: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLegend: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatchIn: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: 'rgba(255,184,0,0.4)',
    borderWidth: 1.5,
    borderColor: colors.yellowDark,
  },
  legendSwatchOut: { width: 11, height: 11, borderRadius: 3, backgroundColor: 'rgba(26,26,26,0.28)' },
  legendLabel: { fontSize: 10.5, fontWeight: '600', color: colors.ink },
  mapNote: { fontSize: 12, fontWeight: '600', color: colors.greyWarm },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
  },
});
