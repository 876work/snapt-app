import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { colors, spacing } from '../../../lib/theme';

const CATS = [
  { label: 'Communication', val: 4.9 },
  { label: 'Punctuality', val: 4.8 },
  { label: 'Respectfulness', val: 5.0 },
];

const REVIEWS = [
  { initial: 'J', name: 'Jordan M.', job: 'Portraits session', date: '2 weeks ago', stars: 5, comment: 'Maya was ready right on time and a joy to shoot with.' },
  { initial: 'A', name: 'Amara J.', job: 'Family session', date: 'last month', stars: 5, comment: 'Clear about what she wanted — made my job easy.' },
  { initial: 'N', name: 'Nia T.', job: 'Wedding session', date: '2 months ago', stars: 4, comment: '' },
];

export default function ClientRatings() {
  return (
    <View style={styles.root}>
      <ScreenHeader title="Your ratings" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Summary card */}
        <View style={styles.heroCard}>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.avg}>4.9</Text>
            <Text style={styles.avgStars}>★★★★★</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroLabel}>How creators rate you</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Svg width={62} height={22} viewBox="0 0 62 22" fill="none">
                <Polyline points="1,16 14,14 27,15 40,9 53,7 61,4" stroke={colors.yellow} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 15l6-6 6 6" stroke="#5FD48F" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={styles.trend}>Trending up</Text>
              </View>
            </View>
            <Text style={styles.heroSub}>From {REVIEWS.length} creators you've booked</Text>
          </View>
        </View>

        {/* Category breakdown */}
        <Text style={styles.sectionTitle}>Category breakdown</Text>
        <View style={styles.catCard}>
          {CATS.map((c) => (
            <View key={c.label}>
              <View style={styles.catHead}>
                <Text style={styles.catLabel}>{c.label}</Text>
                <Text style={styles.catVal}>{c.val.toFixed(1)}</Text>
              </View>
              <View style={styles.catTrack}>
                <View style={[styles.catBar, { width: `${(c.val / 5) * 100}%` }]} />
              </View>
            </View>
          ))}
        </View>

        {/* Recent reviews */}
        <Text style={styles.sectionTitle}>Recent reviews</Text>
        <View style={{ gap: 12 }}>
          {REVIEWS.map((r) => (
            <View key={r.name} style={styles.reviewCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View style={styles.reviewAvatar}>
                  <Text style={styles.reviewInitial}>{r.initial}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.reviewName}>{r.name}</Text>
                  <Text style={styles.reviewMeta}>
                    {r.job} · {r.date}
                  </Text>
                </View>
                <Text style={styles.reviewStars}>
                  {'★'.repeat(r.stars)}
                  <Text style={{ color: '#E4E0D6' }}>{'★'.repeat(5 - r.stars)}</Text>
                </Text>
              </View>
              {!!r.comment && <Text style={styles.reviewComment}>"{r.comment}"</Text>}
            </View>
          ))}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    backgroundColor: colors.ink,
    borderRadius: 18,
    padding: 20,
    paddingHorizontal: 22,
  },
  avg: { fontSize: 44, fontWeight: '800', letterSpacing: -1.5, color: '#fff', lineHeight: 48 },
  avgStars: { fontSize: 14, color: colors.yellow, letterSpacing: 2, marginTop: 4 },
  heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  trend: { fontSize: 12.5, fontWeight: '700', color: '#5FD48F' },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6, lineHeight: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 26, marginBottom: 12 },
  catCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 17,
    paddingHorizontal: 18,
    gap: 15,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  catHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 },
  catLabel: { fontSize: 13.5, fontWeight: '600', color: '#3D3A34' },
  catVal: { fontSize: 14, fontWeight: '800', color: colors.ink },
  catTrack: { height: 7, borderRadius: 4, backgroundColor: '#EFEDE7', overflow: 'hidden' },
  catBar: { height: '100%', borderRadius: 4, backgroundColor: colors.yellow },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 15,
    paddingHorizontal: 17,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  reviewAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFEBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewInitial: { fontSize: 14, fontWeight: '800', color: '#8A7530' },
  reviewName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  reviewMeta: { fontSize: 11.5, color: colors.grey, marginTop: 1 },
  reviewStars: { fontSize: 12, color: colors.yellow, letterSpacing: 1 },
  reviewComment: { fontSize: 13, color: '#3D3A34', lineHeight: 20, marginTop: 11 },
});
