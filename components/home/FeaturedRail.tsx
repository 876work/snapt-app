import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { CreatorAvatar } from '../ui/CreatorAvatar';
import type { FeaturedCreator } from '../../lib/api';
import { colors } from '../../lib/theme';

/**
 * "Featured creators" — NOT "Top creators near you". We have no ratings and
 * no distances, so ranking and proximity were both unearned claims.
 *
 * Cards show REAL PORTFOLIO WORK. The server excludes any creator without
 * published images, so this never renders a coloured square with an initial
 * on a photography marketplace. An empty list is an honest empty state, not
 * a reason to invent filler.
 */
export function FeaturedRail({
  creators,
  loading,
}: {
  creators: FeaturedCreator[] | null;
  loading: boolean;
}) {
  const router = useRouter();

  if (loading) return null;

  const list = creators ?? [];

  return (
    <>
      <View style={styles.head}>
        <Text style={styles.title}>Featured creators</Text>
        {list.length > 0 && (
          <Pressable
            onPress={() => router.push('/creators')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Text style={styles.seeAll}>See all</Text>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        )}
      </View>

      {list.length === 0 ? (
        <View style={styles.empty}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path d="M3.5 7.5A2.5 2.5 0 016 5h2l1.2-1.8h5.6L16 5h2a2.5 2.5 0 012.5 2.5v9A2.5 2.5 0 0118 19H6a2.5 2.5 0 01-2.5-2.5v-9z" stroke={colors.greyLight} strokeWidth={1.7} strokeLinejoin="round" />
            <Circle cx="12" cy="12" r="3.4" stroke={colors.greyLight} strokeWidth={1.7} />
          </Svg>
          <Text style={styles.emptyTitle}>Creators joining soon</Text>
          <Text style={styles.emptyBody}>
            We're onboarding photographers across northern Saint Lucia. You can still book — we'll
            match you with an available creator.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {list.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => router.push(`/booking/creator-preview?id=${c.id}` as never)}
              style={styles.card}
            >
              <View style={styles.workWrap}>
                <Image source={{ uri: c.work[0] }} style={styles.work} resizeMode="cover" />
                {c.work.length > 1 && (
                  <View style={styles.countPill}>
                    <Text style={styles.countLabel}>{c.work.length} shots</Text>
                  </View>
                )}
              </View>
              <View style={styles.body}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {/* The approved headshot — server-gated, so this only ever
                      renders a reviewed photo (initial tile otherwise). */}
                  <View style={styles.avatarChip}>
                    <CreatorAvatar name={c.name} photo={c.photo} textSize={10} />
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {c.verified && (
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15.7l.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.2L12 3z" fill={colors.yellow} />
                      <Path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
                <View style={styles.tagRow}>
                  {c.specialties.slice(0, 2).map((t) => (
                    <View key={t} style={styles.tag}>
                      <Text style={styles.tagLabel}>{t}</Text>
                    </View>
                  ))}
                </View>
                {/* Location only when we actually have one — a blank pin
                    reads as a bug and we cannot claim proximity anyway. */}
                {!!c.loc && (
                  <View style={styles.locRow}>
                    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke="#8A8377" strokeWidth={1.8} strokeLinejoin="round" />
                      <Circle cx="12" cy="10" r="2.3" stroke="#8A8377" strokeWidth={1.8} />
                    </Svg>
                    <Text style={styles.loc}>{c.loc}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  title: { fontSize: 16, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  seeAll: { fontSize: 12.5, fontWeight: '800', color: colors.yellowDark },
  empty: {
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  emptyBody: { fontSize: 12.5, color: colors.grey, textAlign: 'center', lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47.5%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  workWrap: { width: '100%', aspectRatio: 1, backgroundColor: '#EFEBE3' },
  work: { width: '100%', height: '100%' },
  countPill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: 'rgba(26,26,26,0.72)',
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countLabel: { fontSize: 9.5, fontWeight: '800', color: '#fff' },
  body: { padding: 11, gap: 5 },
  avatarChip: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: '#F1EEE7',
  },
  name: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.ink },
  tagRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  tag: { backgroundColor: '#F4F1EA', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  tagLabel: { fontSize: 9, fontWeight: '700', color: colors.greyWarm },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  loc: { fontSize: 10, color: '#8A8377' },
});
