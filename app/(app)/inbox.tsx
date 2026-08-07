import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Text } from '../../lib/text';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';
import { apiBase, authHeaders } from '../../lib/api';

/**
 * The notification inbox.
 *
 * Reads the server. This screen previously rendered a hardcoded array, which
 * is why nothing the backend recorded ever appeared here — the rows existed
 * the whole time, nothing read them.
 *
 * Tabs per handoff §13: All, Bookings, Messages, Promotions. Account and
 * safety events (money, disputes, identity) deliberately have no tab of their
 * own — they are the critical bucket and always show under All, flagged.
 */
const TABS = [
  { label: 'All', key: 'all' },
  { label: 'Bookings', key: 'bookings' },
  { label: 'Messages', key: 'messages' },
  { label: 'Promotions', key: 'promotions' },
] as const;

interface Item {
  id: string;
  trigger_type: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/** Money, safety and identity events read as critical wherever they appear. */
const CRITICAL = new Set(['account', 'safety']);

/**
 * Where a tap lands. A notification that opens a list is barely better than
 * no notification — these go to the thing the notification is about.
 */
function destinationFor(item: Item): string | null {
  const bookingId = (item.data?.booking_id ?? item.data?.bookingId) as string | undefined;
  const deepLink = item.data?.deep_link as string | undefined;
  if (deepLink) return deepLink;

  switch (item.trigger_type) {
    case 'offer_received':
      return '/creator';
    case 'delivery_ready':
    case 'revision_delivered':
    case 'revision_requested':
      return bookingId ? `/(app)/bookings/${bookingId}/delivery` : '/(app)/bookings';
    case 'payout_pending':
    case 'payout_available':
    case 'payout_paid':
      return '/creator/earnings';
    case 'payment_charged':
    case 'refund_processed':
    case 'fee_charged':
    case 'assignment_failed_refunded':
      return '/(app)/wallet';
    case 'application_approved':
    case 'application_rejected':
    case 'application_submitted':
      return '/creator';
    case 'strike_issued':
    case 'suspension_applied':
      return '/creator';
    case 'promotion':
      return null;
    default:
      return bookingId ? `/(app)/bookings/${bookingId}` : null;
  }
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

export default function Inbox() {
  const router = useRouter();
  const [tab, setTab] = React.useState<(typeof TABS)[number]['key']>('all');
  const [items, setItems] = React.useState<Item[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!apiBase) {
      setLoading(false);
      setError("Can't reach the server right now.");
      return;
    }
    try {
      const res = await fetch(`${apiBase}/v1/notifications?tab=${tab}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { notifications: Item[]; unread: number };
      setItems(body.notifications);
      setUnread(body.unread);
      setError(null);
    } catch {
      setError("Couldn't load your notifications. Pull to try again.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  // Refetch on focus, not just on mount: a notification that arrives while
  // the app is open should be here when the user comes back to this tab.
  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  const markRead = React.useCallback(async (ids: string[] | 'all') => {
    if (!apiBase) return;
    const body = ids === 'all' ? { all: true } : { ids };
    // Optimistic: the badge should clear the instant it's tapped.
    setItems((prev) =>
      prev.map((i) =>
        ids === 'all' || ids.includes(i.id) ? { ...i, read_at: i.read_at ?? new Date().toISOString() } : i,
      ),
    );
    try {
      const res = await fetch(`${apiBase}/v1/notifications/read`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      if (res.ok) setUnread(((await res.json()) as { unread: number }).unread);
    } catch {
      /* the row stays unread server-side; the next load corrects it */
    }
  }, []);

  const open = (item: Item) => {
    if (!item.read_at) void markRead([item.id]);
    const to = destinationFor(item);
    if (to) router.push(to as never);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Notifications" />

      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
              <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {unread > 0 && (
          <Pressable onPress={() => markRead('all')} hitSlop={8}>
            <Text style={styles.markAll}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        onScroll={navShrinkOnScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.yellowDark} />}
      >
        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        ) : error ? (
          <View style={styles.centre}>
            <Text style={styles.emptyTitle}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centre}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              {tab === 'promotions'
                ? "Offers and announcements will show up here."
                : "Updates about your bookings and payments will appear here."}
            </Text>
          </View>
        ) : (
          items.map((item) => {
            const critical = CRITICAL.has(item.category);
            const tappable = destinationFor(item) != null;
            return (
              <Pressable
                key={item.id}
                onPress={() => open(item)}
                style={[styles.card, !item.read_at && styles.cardUnread]}
              >
                {!item.read_at && <View style={styles.dot} />}
                <View style={{ flex: 1 }}>
                  <View style={styles.cardHead}>
                    <Text style={[styles.title, !item.read_at && styles.titleUnread]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.time}>{ago(item.created_at)}</Text>
                  </View>
                  <Text style={styles.body} numberOfLines={3}>
                    {item.body}
                  </Text>
                  <View style={styles.metaRow}>
                    {critical && <Text style={styles.critical}>Important</Text>}
                    {tappable && <Text style={styles.chev}>View →</Text>}
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  tabBar: { flexDirection: 'row', alignItems: 'center', paddingRight: 18, gap: 10 },
  tabRow: { paddingHorizontal: 18, paddingBottom: 10, gap: 8 },
  tab: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: '#EFEDE8', justifyContent: 'center' },
  tabActive: { backgroundColor: colors.ink },
  tabLabel: { fontSize: 13, fontWeight: '700', color: colors.grey },
  tabLabelActive: { color: '#fff' },
  markAll: { fontSize: 12.5, fontWeight: '700', color: colors.goldText },
  body: { paddingHorizontal: 18, paddingTop: 4 },
  centre: { alignItems: 'center', justifyContent: 'center', paddingTop: 90, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19, paddingHorizontal: 30 },
  card: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardUnread: { borderColor: '#F0DFA8', backgroundColor: '#FFFDF6' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.yellow, marginTop: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  titleUnread: { fontWeight: '800' },
  time: { fontSize: 11.5, color: '#9A9A9A' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 7 },
  critical: { fontSize: 11, fontWeight: '800', color: '#A32C2C' },
  chev: { fontSize: 11.5, fontWeight: '700', color: colors.goldText },
});
