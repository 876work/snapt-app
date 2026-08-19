import React from 'react';
import { Animated, Dimensions, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { CreatorAvatar } from '../ui/CreatorAvatar';
import { WorkImage } from '../ui/WorkImage';
import type { FeaturedCreator } from '../../lib/api';
import { colors } from '../../lib/theme';
import { useReduceMotion } from '../../lib/useReduceMotion';

/**
 * THE SPACE THIS SECTION HOLDS FROM FIRST PAINT.
 *
 * The rail rendered `null` while its fetch was in flight, so the section had
 * zero height and "How it works" drew where the creators belong — then got
 * shoved down when the answer arrived. A complete-looking layout replaced by
 * a different one, worst on a cold Render start where the gap is 30–60s.
 *
 * Geometry mirrors `styles.card`: two cards to a row at 47.5% of the content
 * width, a square work image, plus the name/tags/location block. Home's
 * content gutters are 20pt a side and the grid gap is 12.
 *
 * The body allowance is deliberately a few points GENEROUS over the real
 * name/tags/location block. Text heights are font-metric dependent and not
 * predictable to the pixel, and the failure directions are not equal: a
 * reservation slightly too tall costs a sliver of whitespace, one slightly
 * too short lets a populated row grow the slot and shift the page — the
 * exact thing this exists to prevent.
 *
 * Read once at module scope: the app is portrait-locked (app.json
 * `orientation: portrait`), so this cannot go stale on rotation.
 */
const CARD_W = (Dimensions.get('window').width - 40 - 12) / 2;
const ROW_H = CARD_W + 92;

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
  failed,
  onRetry,
}: {
  creators: FeaturedCreator[] | null;
  loading: boolean;
  /** The fetch answered with nothing usable — NOT the same as "nobody yet". */
  failed?: boolean;
  onRetry?: () => void;
}) {
  const router = useRouter();

  const list = creators ?? [];
  // All four states live in one component so they share the reserved slot
  // below and cannot disagree about the section's height.
  const resolved = !loading && !failed;

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Creators</Text>
        {resolved && list.length > 0 && (
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

      <View style={styles.slot}>
        {failed ? (
          <Pressable onPress={onRetry} style={styles.railFailed}>
            <Text style={styles.railFailedText}>
              Couldn't load featured creators — tap to retry.
            </Text>
          </Pressable>
        ) : loading ? (
          <RailSkeleton />
        ) : list.length === 0 ? (
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
                  <WorkImage uri={c.work[0]} style={styles.work} />
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
      </View>
    </View>
  );
}

/**
 * Loading, said out loud.
 *
 * Deliberately unlike BOTH resolved states: no border and no copy (the empty
 * card is a bordered white box with an icon and two lines of text), no image
 * and no name (a populated card carries real portfolio work). Just the shape
 * of what is coming, pulsing, so it reads as "not finished" rather than as a
 * result. Motion is skipped entirely under OS reduce-motion — the muted
 * blocks still say loading without it.
 */
function RailSkeleton() {
  const reduced = useReduceMotion();
  const pulse = React.useRef(new Animated.Value(0.55)).current;
  React.useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <View
      style={styles.grid}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading creators"
    >
      {[0, 1].map((i) => (
        <Animated.View
          key={i}
          style={[styles.card, styles.skelCard, reduced ? null : { opacity: pulse }]}
        >
          <View style={styles.skelWork} />
          <View style={styles.body}>
            <View style={[styles.skelBar, { width: '62%' }]} />
            <View style={[styles.skelBar, { width: '40%', height: 9 }]} />
          </View>
        </Animated.View>
      ))}
    </View>
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
  // The floor that stops the section growing under "How it works" when the
  // fetch answers. One card row — see ROW_H.
  slot: { minHeight: ROW_H },
  // Exactly the reserved height, so the skeleton and the slot agree and the
  // pulse cannot itself be the thing that resizes the section.
  skelCard: { height: ROW_H, backgroundColor: '#F1EEE7', shadowOpacity: 0, elevation: 0 },
  skelWork: { width: '100%', aspectRatio: 1, backgroundColor: '#E4DFD6' },
  skelBar: { height: 11, borderRadius: 5, backgroundColor: '#E4DFD6' },
  // Moved here verbatim from home.tsx so the failure shares the slot above
  // and keeps the section header. Inset and colours unchanged.
  railFailed: {
    marginHorizontal: 20,
    marginTop: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#F1EEE7',
  },
  railFailedText: { fontSize: 12.5, color: colors.grey, textAlign: 'center' },
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
