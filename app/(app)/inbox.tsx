import React from 'react';
import { ActivityIndicator, Clipboard, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { Text } from '../../lib/text';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';
import { apiBase, authHeaders } from '../../lib/api';
import { isCreatorTarget, resolveTarget } from '../../lib/notificationTarget';
import { useAuth } from '../../lib/store';

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
 * Where a tap lands — read from the row, not decided here.
 *
 * This screen used to carry its own trigger→route map, which is how it came
 * to disagree with push (which had no routing at all) and how it ended up
 * pointing delivery notifications at /(app)/bookings/{id}/delivery, a route
 * that has never existed. The destination is now resolved once on the
 * server and stored on the row, so a bell tap and a banner tap are the same
 * string. See lib/notificationTarget.ts.
 */
function destinationFor(item: Item): string | null {
  return resolveTarget(item.trigger_type, item.data);
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

export default function Inbox() {
  const router = useRouter();
  const creatorStatus = useAuth((s) => s.creatorStatus);
  const [tab, setTab] = React.useState<(typeof TABS)[number]['key']>('all');
  const [items, setItems] = React.useState<Item[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Toast: one at a time. `undo` present = a delete is pending its 5s window.
  const [toast, setToast] = React.useState<{ text: string; undo?: () => void } | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Deletes waiting out their undo window, by notification id. Held in a ref
   * (not state) so the unmount cleanup below sees the CURRENT set: navigating
   * away mid-countdown must still delete on the server, or the row silently
   * returns on the next load — a delete that didn't delete.
   */
  const pendingDeletes = React.useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());

  const showToast = React.useCallback((text: string, undo?: () => void, ms = 5000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

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

  /** Title + body onto the clipboard — what the row actually says. */
  const copyItem = React.useCallback((item: Item) => {
    Clipboard.setString(`${item.title}\n${item.body}`.trim());
    showToast('Copied');
  }, [showToast]);

  /**
   * Delete with a 5-second grace. The row leaves the list immediately and the
   * SERVER call is deferred to the end of the window — so Undo is a pure
   * local cancel (nothing to reverse remotely), and the destructive call only
   * ever happens once, at the point of no return.
   *
   * Failure restores the row at its original index and says so. A delete that
   * failed must never look like one that worked.
   */
  const deleteItem = React.useCallback(
    (item: Item) => {
      const index = items.findIndex((i) => i.id === item.id);
      const wasUnread = !item.read_at;
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (wasUnread) setUnread((u) => Math.max(0, u - 1)); // badge moves now
      const restore = () => {
        setItems((prev) => {
          if (prev.some((i) => i.id === item.id)) return prev;
          const next = [...prev];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
          return next;
        });
        if (wasUnread) setUnread((u) => u + 1);
      };

      const commit = async () => {
        pendingDeletes.current.delete(item.id);
        if (!apiBase) return;
        try {
          const res = await fetch(`${apiBase}/v1/notifications/${item.id}`, {
            method: 'DELETE',
            headers: await authHeaders(),
          });
          // 404 = already gone server-side; the user's intent is satisfied.
          if (res.ok) {
            setUnread(((await res.json()) as { unread: number }).unread);
            return;
          }
          if (res.status === 404) return;
          throw new Error(String(res.status));
        } catch {
          restore();
          showToast("Couldn't delete that — it's back in your list.");
        }
      };

      const timer = setTimeout(commit, 5000);
      pendingDeletes.current.set(item.id, { timer, run: commit });
      showToast('Notification deleted', () => {
        const pending = pendingDeletes.current.get(item.id);
        if (pending) clearTimeout(pending.timer);
        pendingDeletes.current.delete(item.id);
        restore();
        setToast(null);
      });
    },
    [items, showToast],
  );

  // Leaving the screen must not cancel a delete the user already asked for:
  // flush every pending window immediately so it lands server-side.
  React.useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      for (const { timer, run } of pending.values()) {
        clearTimeout(timer);
        void run();
      }
    };
  }, []);

  const open = (item: Item) => {
    if (!item.read_at) void markRead([item.id]);
    const to = destinationFor(item);
    if (!to) return;
    // Same access rule the push tap handler applies: a creator-only screen
    // opened while not an approved creator goes to /creator, whose layout
    // lands them on the screen for their actual status rather than a
    // locked-out blank.
    if (isCreatorTarget(to) && creatorStatus !== 'approved') {
      router.push('/creator');
      return;
    }
    router.push(to as never);
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
              <SwipeRow
                key={item.id}
                onCopy={() => copyItem(item)}
                onDelete={() => deleteItem(item)}
              >
              <Pressable
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
              </SwipeRow>
            );
          })
        )}
        <View style={{ height: 120 }} />
      </ScrollView>

      {toast && (
        <View style={styles.toast} pointerEvents="box-none">
          <Text style={styles.toastText}>{toast.text}</Text>
          {toast.undo && (
            <Pressable onPress={toast.undo} hitSlop={10}>
              <Text style={styles.toastUndo}>Undo</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Swipe-left row actions. Uses the gesture/animation stack already in the
 * app (react-native-gesture-handler's ReanimatedSwipeable + reanimated) —
 * no new dependency, so this ships over the air to existing builds.
 */
function SwipeRow({
  children,
  onCopy,
  onDelete,
}: {
  children: React.ReactNode;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const ref = React.useRef<React.ComponentRef<typeof ReanimatedSwipeable>>(null);
  const renderRightActions = (
    _progress: SharedValue<number>,
    translation: SharedValue<number>,
  ) => <RowActions translation={translation} onCopy={() => { onCopy(); ref.current?.close(); }} onDelete={onDelete} />;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

function RowActions({
  translation,
  onCopy,
  onDelete,
}: {
  translation: SharedValue<number>;
  onCopy: () => void;
  onDelete: () => void;
}) {
  // Actions track the drag so they appear to sit under the row rather than
  // snapping in at the end of the gesture.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value + ACTIONS_WIDTH }],
  }));
  return (
    <Reanimated.View style={[styles.actions, style]}>
      <Pressable onPress={onCopy} style={[styles.action, styles.actionCopy]}>
        <Text style={styles.actionLabel}>Copy</Text>
      </Pressable>
      <Pressable onPress={onDelete} style={[styles.action, styles.actionDelete]}>
        <Text style={[styles.actionLabel, { color: '#fff' }]}>Delete</Text>
      </Pressable>
    </Reanimated.View>
  );
}

const ACTIONS_WIDTH = 168;

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
  actions: { width: ACTIONS_WIDTH, flexDirection: 'row', alignItems: 'stretch', marginBottom: 10 },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { backgroundColor: '#E8E4DA' },
  actionDelete: { backgroundColor: colors.error, borderTopRightRadius: 14, borderBottomRightRadius: 14 },
  actionLabel: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  toast: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 110,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toastText: { flex: 1, fontSize: 13.5, color: '#fff', fontWeight: '600' },
  toastUndo: { fontSize: 13.5, fontWeight: '800', color: colors.yellow },
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
