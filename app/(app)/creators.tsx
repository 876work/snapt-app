import React from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { WorkImage } from '../../components/ui/WorkImage';
import type { FeaturedCreator } from '../../lib/api';
import { colors, insetBottom } from '../../lib/theme';

/**
 * THE CREATOR DIRECTORY — every creator a client can actually book.
 *
 * This screen used to call fetchFeaturedCreators, the same capped shop
 * window behind the home rail, so "See all" showed the same handful and
 * silently omitted anyone without published work. It now reads the
 * directory endpoint, whose only test is bookability: approved, available,
 * and with working hours. Someone paused or with an empty week is left out
 * deliberately — listing them produces a client who picks a creator the
 * matcher will never offer the job to.
 *
 * Four per page, because the card carries a portfolio preview and a denser
 * grid turns the photography into thumbnails nobody can judge.
 */
const PER_PAGE = 4;

export default function CreatorsList() {
  const router = useRouter();
  const [creators, setCreators] = React.useState<FeaturedCreator[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const scrollRef = React.useRef<ScrollView>(null);
  const width = Dimensions.get('window').width;

  const load = React.useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const { apiConfigured, fetchAllCreators } = await import('../../lib/api');
    if (!apiConfigured) {
      setCreators([]);
      setLoading(false);
      return;
    }
    const list = await fetchAllCreators();
    // null = the request failed. Never render that as "no creators" — it
    // tells a client the marketplace is empty when it is not.
    if (!list) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setCreators(list);
    setPage(0);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const all = creators ?? [];
  const pageCount = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const pages = Array.from({ length: pageCount }, (_, i) =>
    all.slice(i * PER_PAGE, i * PER_PAGE + PER_PAGE),
  );

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(pageCount - 1, next));
    setPage(clamped);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Creators" />

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.yellowDark} />
        </View>
      ) : failed ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>Couldn't load creators</Text>
          <Text style={styles.stateSub}>
            This is a connection problem — there are creators available.
          </Text>
          <Pressable onPress={load} style={styles.retry}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : all.length === 0 ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>No creators available right now</Text>
          <Text style={styles.stateSub}>
            Everyone is either fully booked or has paused new work. Check back shortly.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.count}>
            {all.length} creator{all.length === 1 ? '' : 's'} available to book
          </Text>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setPage(Math.round(e.nativeEvent.contentOffset.x / width))
            }
          >
            {pages.map((group, i) => (
              <ScrollView
                key={i}
                style={{ width }}
                contentContainerStyle={styles.pageBody}
                showsVerticalScrollIndicator={false}
              >
                {group.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push(`/booking/creator-preview?id=${c.id}` as never)}
                    style={styles.card}
                  >
                    <View style={styles.workWrap}>
                      <WorkImage
                        uri={c.work[0]}
                        style={styles.work}
                        label={c.work.length === 0 ? 'No portfolio yet' : "Preview didn't load"}
                      />
                      {c.work.length > 1 && (
                        <View style={styles.countPill}>
                          <Text style={styles.countLabel}>{c.work.length} shots</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.body}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={styles.avatarChip}>
                          <CreatorAvatar name={c.name} photo={c.photo} textSize={11} />
                        </View>
                        <Text style={styles.name} numberOfLines={1}>
                          {c.name}
                        </Text>
                        {c.verified && (
                          <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                            <Path
                              d="M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15.7l.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.2L12 3z"
                              fill={colors.yellow}
                            />
                            <Path
                              d="M9 12l2 2 4-4"
                              stroke="#fff"
                              strokeWidth={1.9}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </Svg>
                        )}
                      </View>
                      <Text style={styles.specialties} numberOfLines={1}>
                        {(c.specialties ?? []).slice(0, 3).join(' · ') || 'Photography'}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            ))}
          </ScrollView>

          {pageCount > 1 && (
            <View style={styles.pager}>
              <Pressable
                onPress={() => goTo(page - 1)}
                disabled={page === 0}
                style={[styles.navBtn, page === 0 && styles.navBtnOff]}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M15 6l-6 6 6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
              <View style={styles.dots}>
                {pages.map((_, i) => (
                  <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
                ))}
              </View>
              <Text style={styles.pageLabel}>
                {page + 1} of {pageCount}
              </Text>
              <Pressable
                onPress={() => goTo(page + 1)}
                disabled={page === pageCount - 1}
                style={[styles.navBtn, page === pageCount - 1 && styles.navBtnOff]}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 6l6 6-6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  count: { fontSize: 12.5, color: colors.grey, paddingHorizontal: 22, paddingBottom: 8 },
  pageBody: { paddingHorizontal: 22, paddingBottom: 12 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 8 },
  stateTitle: { fontSize: 16, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateSub: { fontSize: 13, color: colors.grey, lineHeight: 19, textAlign: 'center' },
  retry: {
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.yellow,
  },
  retryLabel: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  workWrap: { height: 104, backgroundColor: '#EFEBE3' },
  work: { width: '100%', height: '100%' },
  countPill: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(26,26,26,0.72)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countLabel: { fontSize: 10.5, fontWeight: '800', color: '#fff' },
  body: { padding: 12, gap: 4 },
  avatarChip: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  name: { fontSize: 14.5, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  specialties: { fontSize: 11.5, color: colors.greyWarm },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: insetBottom + 90,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E7E3DA',
  },
  navBtnOff: { opacity: 0.35 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D8D2C4' },
  dotOn: { backgroundColor: colors.ink, width: 16 },
  pageLabel: { fontSize: 12, fontWeight: '700', color: colors.grey, minWidth: 52, textAlign: 'center' },
});
