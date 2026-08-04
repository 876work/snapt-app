import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../lib/text';
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

// Real aggregates in API mode: this account's received ratings (as client
// and, for creators, as creator). Mock values remain the offline preview.
export default function ClientRatings() {
  const [real, setReal] = React.useState<import('../../../lib/api').RatingsSummary | null | 'loading'>('loading');
  React.useEffect(() => {
    import('../../../lib/api').then(({ apiConfigured, fetchMyRatingsApi }) => {
      if (!apiConfigured) {
        setReal(null); // mock preview
        return;
      }
      fetchMyRatingsApi().then((r) => {
        if (!r) return setReal(null);
        // Prefer the creator-side summary when it has data.
        setReal(r.as_creator.count > 0 ? r.as_creator : r.as_client);
      });
    });
  }, []);

  const isReal = real !== null && real !== 'loading';
  const avg = isReal ? real.average : 4.9;
  const count = isReal ? real.count : REVIEWS.length;
  const cats = isReal
    ? Object.entries(real.categories).map(([k, v]) => ({
        label: k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        val: v,
      }))
    : CATS;
  const reviews = isReal
    ? real.recent.map((r, i) => ({
        initial: '★',
        name: `Review ${i + 1}`,
        job: '',
        date: new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        stars: Math.round(r.rating),
        comment: r.comment ?? '',
      }))
    : REVIEWS;

  if (isReal && count === 0) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Your ratings" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink }}>No ratings yet</Text>
          <Text style={{ fontSize: 13, color: colors.grey, textAlign: 'center', marginTop: 8, lineHeight: 19 }}>
            Ratings appear here after your first completed booking is reviewed.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your ratings" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Summary card */}
        <View style={styles.heroCard}>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.avg}>{avg != null ? avg.toFixed(1) : "—"}</Text>
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
            <Text style={styles.heroSub}>From {count} completed booking{count === 1 ? "" : "s"}</Text>
          </View>
        </View>

        {/* Category breakdown */}
        <Text style={styles.sectionTitle}>Category breakdown</Text>
        <View style={styles.catCard}>
          {cats.map((c) => (
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
          {reviews.map((r) => (
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
