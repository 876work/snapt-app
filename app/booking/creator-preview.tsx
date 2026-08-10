import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { creatorById, useBookings } from '../../lib/store';
import { colors, spacing, insetBottom } from '../../lib/theme';

const SAMPLE_TINTS = ['#F2C14E', '#6FD3E0', '#F2A0B5', '#8ED7A6'];

// NO invented reviews or rating breakdown here. This screen shows a REAL
// creator to a client deciding whether to hire them; fabricated testimonials
// attributed to that person are not a placeholder, they are a false claim
// about someone's work. Until there is a reviews endpoint, the honest thing
// is to say we have nothing to show yet.

export default function CreatorPreview() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setDraft } = useBookings();
  const creator = creatorById(String(id));

  if (!creator) return null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Creator profile" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Header card */}
        <View style={styles.headCard}>
          <View style={[styles.photo, { backgroundColor: creator.tint }]}>
            <CreatorAvatar name={creator.name} photo={creator.photo} textSize={26} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.name}>{creator.name}</Text>
              {creator.verified && (
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15.7l.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.2L12 3z" fill={colors.yellow} />
                  <Path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              )}
            </View>
            {creator.verified && (
              <View style={styles.verifiedPill}>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 3l7 2.5v5.6c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.5L12 3z" fill={colors.success} />
                  <Path d="M9.2 12l2 2 3.6-3.6" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={styles.verifiedLabel}>Verified Creator</Text>
              </View>
            )}
            <Text style={styles.spec}>{creator.specialties.join(' · ')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill={colors.yellow}>
                  <Path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />
                </Svg>
                <Text style={styles.rating}>
                  {creator.rating != null ? (
                    <>
                      {creator.rating.toFixed(1)} <Text style={styles.reviews}>({creator.sessions})</Text>
                    </>
                  ) : (
                    'New'
                  )}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke="#8A8377" strokeWidth={1.8} strokeLinejoin="round" />
                  <Circle cx="12" cy="10" r="2.3" stroke="#8A8377" strokeWidth={1.8} />
                </Svg>
                <Text style={styles.dist}>
                  {creator.loc || '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Past work */}
        <Text style={styles.sectionLabel}>Past work</Text>
        <View style={styles.sampleGrid}>
          {SAMPLE_TINTS.map((tint, i) => (
            <View key={i} style={[styles.sample, { backgroundColor: tint }]} />
          ))}
        </View>

        {/* Reviews — real ones only, and there is no endpoint for them yet. */}
        <Text style={styles.sectionLabel}>Reviews</Text>
        <View style={styles.reviewEmpty}>
          <Text style={styles.reviewEmptyTitle}>No reviews to show yet</Text>
          <Text style={styles.reviewEmptyBody}>
            {creator.sessions > 0
              ? `${creator.name} has completed ${creator.sessions} ${creator.sessions === 1 ? 'session' : 'sessions'} on Snapt. Written reviews are coming soon.`
              : `${creator.name} is new to Snapt. Reviews appear here once clients have rated their sessions.`}
          </Text>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title={`Choose ${creator.name}`}
          arrow
          onPress={() => {
            setDraft({ creatorId: creator.id });
            router.back();
          }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reviewEmpty: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 5,
  },
  reviewEmptyTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  reviewEmptyBody: { fontSize: 12.5, color: colors.grey, lineHeight: 19 },
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  headCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 15,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  photo: { width: 70, height: 70, borderRadius: 18, overflow: 'hidden' },
  name: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#EAF8F0',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginTop: 6,
  },
  verifiedLabel: { fontSize: 9.5, fontWeight: '800', color: '#12784A', letterSpacing: 0.2 },
  spec: { fontSize: 10.5, color: colors.greyWarm, marginTop: 5 },
  rating: { fontSize: 11, fontWeight: '800', color: colors.ink },
  reviews: { color: colors.greyWarm, fontWeight: '600' },
  dist: { fontSize: 10, color: colors.greyWarm, fontWeight: '600' },
  sectionLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.yellowDark,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 9,
    marginHorizontal: 2,
  },
  sampleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sample: { width: '48%', flexGrow: 1, height: 92, borderRadius: 13 },
  breakCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 15,
    gap: 11,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  breakRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  breakLabel: { width: 82, fontSize: 10.5, fontWeight: '700', color: '#5C574E' },
  breakTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#F1EEE7', overflow: 'hidden' },
  breakBar: { height: '100%', borderRadius: 3, backgroundColor: colors.yellow },
  breakVal: { fontSize: 10.5, fontWeight: '800', width: 24, textAlign: 'right', color: colors.ink },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 15,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reviewName: { fontSize: 12, fontWeight: '800', color: colors.ink },
  reviewStars: { fontSize: 11, color: colors.yellow, letterSpacing: 1 },
  reviewText: { fontSize: 10.5, color: '#5C574E', lineHeight: 16, marginTop: 6 },
  reviewDate: { fontSize: 9, color: '#9A948B', marginTop: 6 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
});
