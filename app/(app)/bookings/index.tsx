import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../lib/text';
import { useFocusEffect, useRouter } from 'expo-router';
import { Card } from '../../../components/ui/Misc';
import { OccasionIcon } from '../../../components/ui/Icons';
import { creatorById, useAuth, useBookings } from '../../../lib/store';
import { formatMoney } from '../../../lib/constants/business';
import { Booking, BookingStatus } from '../../../lib/mock/data';
import { colors, spacing, insetTop, navPillClearance } from '../../../lib/theme';
import { navShrinkOnScroll } from '../../../lib/navShrink';
import { haptic } from '../../../lib/haptics';

/**
 * THREE TABS, because this list is not one kind of thing.
 *
 * Everyone's bookings land here — including a creator's own, since creators
 * book as clients too — and a flat list mixes a shoot next Tuesday, an edit
 * being worked on right now, and a job from March into one scroll.
 *
 * Cancelled is a STATE inside Completed, not a tab of its own: it is
 * finished, it is rare, and giving it a tab would put an empty screen in
 * front of most people most of the time. The status badge still says which.
 */
type Tab = 'upcoming' | 'in_progress' | 'completed';
const TABS: { key: Tab; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
];

const EMPTY_COPY: Record<Tab, { title: string; body: string }> = {
  upcoming: {
    title: 'Nothing coming up',
    body: 'Sessions you have booked but not had yet show here.',
  },
  in_progress: {
    title: 'Nothing in progress',
    body: 'A session underway, or an edit being worked on, shows here until it is delivered.',
  },
  completed: {
    title: 'Nothing completed yet',
    body: 'Delivered work lives here, along with anything cancelled.',
  },
};

/**
 * Which tab a booking belongs to.
 *
 * `deliveredAt` — not the status — is what makes something complete. A
 * booking can read 'completed' the moment an in-person session ends while
 * the edit is still owed; the client is still waiting, so it stays In
 * progress until the files actually arrive.
 */
function tabFor(b: Booking, now: number): Tab {
  if (b.status === 'cancelled' || b.status === 'no-show') return 'completed';
  if (b.deliveredAt) return 'completed';
  // A remote order has no session to wait for — it is work from the moment
  // it is paid for, so it is never "upcoming".
  if (b.type === 'remote') return 'in_progress';
  const start = new Date(b.scheduledAt).getTime();
  if (Number.isNaN(start)) return 'in_progress';
  const end = start + (b.durationHours || 1) * 3600_000;
  return now < end ? 'upcoming' : 'in_progress';
}

const STATUS_STYLE: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: colors.goldText, bg: colors.yellowTint },
  confirmed: { label: 'Confirmed', color: '#1E7A45', bg: '#E7F8EE' },
  completed: { label: 'Completed', color: colors.grey, bg: '#F0EEE8' },
  cancelled: { label: 'Cancelled', color: colors.errorDark, bg: colors.errorSoft },
  'no-show': { label: 'No-show', color: colors.errorDark, bg: colors.errorSoft },
  disputed: { label: 'Disputed', color: colors.errorDark, bg: colors.errorSoft },
};

export default function Bookings() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const bookings = useBookings((s) => s.bookings);
  const loaded = useBookings((s) => s.bookingsLoaded);
  const [error, setError] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('upcoming');

  /**
   * Pull the real list from the server. The store starts EMPTY now — it used
   * to start as SEED_BOOKINGS and nothing ever replaced it, so this screen
   * showed invented bookings while genuine ones sat in the database.
   */
  const load = React.useCallback(async () => {
    const { apiConfigured, fetchMyBookings, toClientBooking } = await import('../../../lib/api');
    if (!apiConfigured) {
      useBookings.getState().hydrateBookings([]);
      return;
    }
    // Creator names on these cards come from the catalog, which is also no
    // longer seeded — pull it alongside so "with Jordan M." resolves.
    const { fetchFeaturedCreators } = await import('../../../lib/api');
    fetchFeaturedCreators().then((list) => {
      if (list?.length) useBookings.getState().registerCreators(list);
    });
    const rows = await fetchMyBookings();
    if (rows == null) {
      setError(true);
      return;
    }
    setError(false);
    useBookings.getState().hydrateBookings(rows.map(toClientBooking));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  // Recomputed per render rather than memoised on a clock: "upcoming" is a
  // comparison against now, and a stale `now` would strand a session that
  // started while the screen was open in the wrong tab.
  const now = Date.now();
  const counts: Record<Tab, number> = { upcoming: 0, in_progress: 0, completed: 0 };
  for (const b of bookings) counts[tabFor(b, now)] += 1;
  const shown = bookings
    .filter((b) => tabFor(b, now) === tab)
    // Upcoming reads forward (soonest first); the other two read backward
    // (most recent first) — what you want next vs what just happened.
    .sort((a, z) => {
      const at = new Date(a.scheduledAt).getTime();
      const zt = new Date(z.scheduledAt).getTime();
      return tab === 'upcoming' ? at - zt : zt - at;
    });

  return (
    <View style={styles.root}>
      <ScrollView
        onScroll={navShrinkOnScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            // The pull is the user's own gesture reaching its trigger —
            // the same 'you got there' tick the slider gives.
            onRefresh={() => {
              haptic('light');
              load();
            }}
            tintColor={colors.yellowDark}
          />
        }
      >
        <Text style={styles.title}>Bookings</Text>
        {loaded && !error && bookings.length > 0 && (
          <View style={styles.tabs}>
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  style={[styles.tab, active && styles.tabActive]}
                >
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                    {t.label}
                    {counts[t.key] > 0 ? ` ${counts[t.key]}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {!loaded && !error ? (
          <View style={styles.state}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>Couldn't load your bookings</Text>
            <Text style={styles.stateBody}>Pull down to try again.</Text>
          </View>
        ) : bookings.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>No bookings yet</Text>
            <Text style={styles.stateBody}>
              Once you book a session it'll show up here with its status and details.
            </Text>
          </View>
        ) : shown.length === 0 ? (
          // An empty TAB is not an empty account — say which, or the filter
          // reads as lost data.
          <View style={styles.state}>
            <Text style={styles.stateTitle}>{EMPTY_COPY[tab].title}</Text>
            <Text style={styles.stateBody}>{EMPTY_COPY[tab].body}</Text>
          </View>
        ) : null}
        {shown.map((b) => {
          const c = creatorById(b.creatorId);
          const d = new Date(b.scheduledAt);
          const st = STATUS_STYLE[b.status];
          return (
            <Pressable key={b.id} onPress={() => router.push(`/bookings/${b.id}`)} style={{ marginBottom: 10 }}>
              <Card style={styles.card}>
                <OccasionIcon occasion={b.occasion} size={30} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {b.occasion} {c ? `with ${c.name}` : ''}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
                    {d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {b.area ? ` · ${b.area}` : ''}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeLabel, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
                <Text style={styles.price}>{formatMoney(b.priceUsd, currency)}</Text>
              </Card>
            </Pressable>
          );
        })}
        <View style={{ height: 130 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 6 },
  stateTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateBody: { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19 },
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: insetTop + 23, paddingBottom: navPillClearance },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, marginBottom: 18 },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#F0EEE8',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabActive: { backgroundColor: '#fff' },
  tabLabel: { fontSize: 12, fontWeight: '700', color: colors.grey },
  tabLabelActive: { color: colors.ink, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  cardTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  cardMeta: { fontSize: 12, color: colors.grey, marginTop: 3 },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 6,
  },
  badgeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  price: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
