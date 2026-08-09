import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, insetBottom, insetTop } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';
import { ScheduleEditor } from '../../components/creator/ScheduleEditor';

/**
 * SCHEDULE — dated, in-person work, and the availability that governs it.
 *
 * Two things were wrong here. Remote edit orders appeared under "Just
 * accepted": remote work has no date, no time and no place, so it has no
 * meaning on a calendar screen — the same type-leak that put a meeting point
 * on a remote job. Remote work lives in the Jobs queue, which is a work
 * queue, not a diary.
 *
 * And "Just accepted" is a status, not a timeframe: it answered "what did I
 * agree to recently" when the question this screen exists to answer is
 * "where do I have to be, and when". It is now UPCOMING, in date order.
 *
 * The list reads the server directly rather than the local offer store,
 * which only populated if the Jobs screen had already run — so arriving here
 * first showed nothing at all.
 */

interface UpcomingJob {
  id: string;
  title: string;
  startsAt: Date;
  area: string;
}

export default function CreatorSchedule() {
  const router = useRouter();
  const [jobs, setJobs] = React.useState<UpcomingJob[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const { apiConfigured, fetchMyBookings } = await import('../../lib/api');
    if (!apiConfigured) {
      setJobs([]);
      setLoading(false);
      return;
    }
    const rows = await fetchMyBookings();
    if (!rows) {
      // null = the request failed. Never render that as "nothing on".
      setLoading(false);
      setFailed(true);
      return;
    }
    const { useAuth } = await import('../../lib/store');
    const me = useAuth.getState().userId;
    // Start of today, so a session earlier today is still "upcoming" rather
    // than vanishing from the screen hours before it happens.
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    setJobs(
      rows
        .filter(
          (b) =>
            b.creator_id === me &&
            b.type === 'in_person' &&
            b.status === 'confirmed' &&
            b.scheduled_at != null &&
            new Date(b.scheduled_at) >= from,
        )
        .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
        .map((b) => ({
          id: b.id,
          title: b.occasion ? `${b.occasion} session` : 'Session',
          startsAt: new Date(b.scheduled_at as string),
          area: b.area ?? 'Area to confirm',
        })),
    );
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const dayLabel = (d: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Schedule</Text>
      </View>
      <ScrollView
        onScroll={navShrinkOnScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. UPCOMING — three distinct states, and no section at all when
            there is genuinely nothing on. */}
        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        ) : failed ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Couldn't load your upcoming work</Text>
            <Text style={styles.stateSub}>
              This is a connection problem, not an empty diary — your bookings are safe.
            </Text>
            <Pressable onPress={load} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : (jobs ?? []).length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>UPCOMING</Text>
            {jobs!.map((j) => (
              <Pressable
                key={j.id}
                onPress={() => router.push(`/creator/job/${j.id}`)}
                style={styles.card}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle}>{j.title}</Text>
                  <View style={styles.metaRow}>
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.grey} strokeWidth={1.8} />
                      <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
                    </Svg>
                    <Text style={styles.metaLabel}>
                      {dayLabel(j.startsAt)} ·{' '}
                      {j.startsAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                      <Circle cx="12" cy="10" r="2.3" stroke={colors.grey} strokeWidth={1.8} />
                    </Svg>
                    <Text style={styles.metaLabel}>{j.area}</Text>
                  </View>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </>
        ) : null}

        {/* 2 + 3. Working hours and blocked dates. */}
        <ScheduleEditor />

        {/* 4. Past work is a lookup, not live work — a quiet line at the foot. */}
        <Pressable onPress={() => router.push('/creator/history')} style={styles.historyRow}>
          <Text style={styles.historyLabel}>Past & completed jobs</Text>
          <Text style={styles.historyChevron}>›</Text>
        </Pressable>
        <View style={{ height: insetBottom + 90 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  header: { paddingTop: insetTop + 19, paddingHorizontal: 22, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35, color: colors.ink },
  body: { paddingHorizontal: 22, paddingTop: 6 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.yellowDark,
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 9,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 15,
    paddingHorizontal: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardTitle: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  metaLabel: { fontSize: 11.5, color: colors.greyWarm },
  chevron: { fontSize: 20, color: colors.greyWarm, fontWeight: '700' },
  state: { paddingVertical: 26, alignItems: 'center' },
  stateCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginTop: 10,
    alignItems: 'center',
    gap: 8,
  },
  stateTitle: { fontSize: 14, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateSub: { fontSize: 12.5, color: colors.grey, lineHeight: 18, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.yellow,
  },
  retryLabel: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 4,
    marginTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2DED5',
  },
  historyLabel: { fontSize: 13.5, fontWeight: '700', color: colors.greyWarm },
  historyChevron: { fontSize: 19, color: colors.greyWarm, fontWeight: '700' },
});
