import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Text } from '../../../lib/text';
import { CreatorAvatar } from '../../../components/ui/CreatorAvatar';
import { colors, spacing, insetTop, navPillClearance } from '../../../lib/theme';
import { STATUS_TONE, threadStatus, threadSubject } from '../../../lib/threadStatus';
import { navShrinkOnScroll } from '../../../lib/navShrink';
import { apiBase, authHeaders } from '../../../lib/api';

/**
 * The Messages tab: every real conversation thread the user is party to,
 * newest activity first. A list view onto lib/chat.ts's own per-booking
 * threads (in-person session chat and remote order chat both write to the
 * same `messages` table) — not a new, separate inbox, and there is no path
 * to message someone without a shared booking.
 */
interface Thread {
  booking_id: string;
  other_id: string;
  other_name: string;
  /** The other account is switched off — the thread is read-only. */
  other_disabled?: boolean;
  other_avatar: string | null;
  type: 'in_person' | 'remote';
  /** null on remote orders — they have no occasion step. */
  occasion: string | null;
  scheduled_at: string | null;
  status: string;
  /** Non-null is what makes a booking delivered — see lib/threadStatus. */
  delivered_at?: string | null;
  last_message: { body: string; created_at: string; mine: boolean } | null;
  unread: number;
  closed: boolean;
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Messages() {
  const router = useRouter();
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!apiBase) {
      setLoading(false);
      setError("Can't reach the server right now.");
      return;
    }
    try {
      const res = await fetch(`${apiBase}/v1/messages/threads`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { threads: Thread[] };
      setThreads(body.threads);
      setError(null);
    } catch {
      setError("Couldn't load your messages. Pull to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch on focus: a message sent while the app was elsewhere, or read
  // just now inside a thread, should be reflected the moment this list is
  // back on screen — not just at next app launch.
  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.body}
        onScroll={navShrinkOnScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
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
        ) : threads.length === 0 ? (
          <View style={styles.centre}>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptyBody}>
              Conversations appear here once a creator accepts your booking. Book a session to
              get started.
            </Text>
            <Pressable onPress={() => router.push('/(app)/home')} style={styles.emptyCta}>
              <Text style={styles.emptyCtaLabel}>Go to Home</Text>
            </Pressable>
          </View>
        ) : (
          threads.map((t) => {
            const unread = t.unread > 0;
            // A thread with no messages was created BY a booking, not by
            // anyone choosing to talk. It stays exactly where the sort put it
            // — a session tomorrow belongs near the top whether or not a word
            // has been said — but it is drawn as the outline of a
            // conversation rather than one, so real threads carry the page.
            const quiet = !t.last_message;
            const { phrase, tone } = threadStatus(t);
            return (
              <Pressable
                key={t.booking_id}
                onPress={() => router.push(`/(app)/messages/${t.booking_id}` as never)}
                style={[styles.row, quiet && styles.rowQuiet, unread && styles.rowUnread]}
              >
                <View style={styles.avatar}>
                  <CreatorAvatar
                    name={t.other_name}
                    photo={t.other_avatar ? { uri: t.other_avatar } : null}
                    textSize={15}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.rowHead}>
                    {unread && <View style={styles.dot} />}
                    <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
                      {t.other_name}
                    </Text>
                    <Text style={styles.time}>
                      {t.last_message ? ago(t.last_message.created_at) : ''}
                    </Text>
                  </View>
                  <View style={styles.subjectRow}>
                    <Text style={styles.subject} numberOfLines={1}>
                      {threadSubject(t)} <Text style={{ color: STATUS_TONE[tone] }}>· {phrase}</Text>
                    </Text>
                    {/* The account being switched off used to be discoverable
                        only by opening the thread and finding the composer
                        locked. It is on the wire here already. */}
                    {t.other_disabled && (
                      <View style={styles.offChip}>
                        <Text style={styles.offChipLabel}>SWITCHED OFF</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.preview,
                      unread && styles.previewUnread,
                      quiet && styles.previewQuiet,
                    ]}
                    numberOfLines={1}
                  >
                    {t.last_message
                      ? `${t.last_message.mine ? 'You: ' : ''}${t.last_message.body}`
                      : 'No messages yet'}
                  </Text>
                </View>
                {unread && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeLabel}>{t.unread > 9 ? '9+' : t.unread}</Text>
                  </View>
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  header: { paddingTop: insetTop + 19, paddingHorizontal: 22, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35, color: colors.ink },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 6, paddingBottom: navPillClearance },
  centre: { alignItems: 'center', justifyContent: 'center', paddingTop: 90, gap: 8, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19, paddingHorizontal: 20 },
  emptyCta: {
    marginTop: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaLabel: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 10,
  },
  /**
   * UNREAD HAS TO BE VISIBLE FROM ARM'S LENGTH.
   *
   * This was a #FFFDF6 fill on a #FFFFFF card and one font-weight step —
   * about a 1% difference, which is none. A thirteen-hour-old question read
   * as a thread nobody had ever used. Three signals now carry it: the fill,
   * the dot beside the name, and the count on the right.
   */
  rowUnread: { borderColor: colors.yellowSoftBorder, backgroundColor: colors.yellowSoft },
  /** Empty threads: same card, no fill — an outline, not a conversation. */
  rowQuiet: { backgroundColor: colors.offWhite, borderColor: colors.borderWarm },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#EFEBE3',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.yellowDark, marginRight: -2 },
  // Read names sit at 600 so the 800 of an unread one is a real step, not the
  // hairline 700 → 800 it used to be.
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  nameUnread: { fontWeight: '800' },
  time: { fontSize: 11, color: '#9A9A9A' },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  // flexShrink, not flex: the chip beside it must keep its width and the
  // subject must give way, or a long occasion squeezes "SWITCHED OFF" to
  // nothing on a narrow screen.
  subject: { flexShrink: 1, fontSize: 11.5, color: colors.yellowDark, fontWeight: '700' },
  offChip: {
    backgroundColor: colors.segBg,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  offChipLabel: { fontSize: 8.5, fontWeight: '800', color: colors.greyWarm, letterSpacing: 0.3 },
  preview: { fontSize: 12.5, color: colors.grey, marginTop: 2 },
  previewUnread: { color: colors.ink, fontWeight: '600' },
  // greyFaint, not greyLight: this line sits on the screen's own background
  // with no card behind it, and greyLight there is close to unreadable.
  previewQuiet: { color: colors.greyFaint },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeLabel: { fontSize: 10.5, fontWeight: '800', color: colors.ink },
});
