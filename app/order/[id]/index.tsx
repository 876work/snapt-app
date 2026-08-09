import React from 'react';
import { ActivityIndicator, AppState, Clipboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from '../../../lib/text';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { useReduceMotion } from '../../../lib/useReduceMotion';
import { colors, insetBottom } from '../../../lib/theme';
import type { MediaListing, ServerBookingListItem } from '../../../lib/api';
import { REMOTE_PACKAGES } from '../../../lib/store/upload';

/**
 * Order tracker — every value on this screen comes from the server.
 *
 * The previous version was a demo shell: the stage lived in local state
 * (starting at "In progress" regardless of reality), an "Advance status
 * (demo)" button mutated it, the delivery estimate ("2 days") and the time
 * chip ("2–4 hours") were two contradictory hardcoded strings, the style
 * and file count were invented, and the creator card fell back to a mock
 * catalog entry — a fabricated person on a real order.
 *
 * Now: the booking row drives the stage; the estimate and the chip are both
 * computed from the SAME admin-configured delivery_windows value, so they
 * cannot disagree; details come from the pricing snapshot and a real file
 * count; and the screen polls while open so a stage change appears without
 * backing out. Three fetch states, creators.tsx-style — a failed fetch
 * renders as a failure, never as a normal-looking order.
 */

type Stage = 0 | 1 | 2;

interface OrderData {
  booking: ServerBookingListItem;
  windows: { standardHours: number; rushHours: number };
  media: MediaListing | null;
  editor: { name: string; avatar: string | null } | null;
  revisionsUsed: number;
}

const STAGE_COPY: Record<Stage, { title: string; desc: string }> = {
  0: {
    title: 'Files received',
    desc: "Your footage landed safely. We're assigning it to your editor now.",
  },
  1: {
    title: 'Your edit is in progress',
    desc: 'Your editor is working through your files with your chosen style.',
  },
  2: {
    title: 'Your edit is ready!',
    desc: 'Everything is polished and waiting for you. Take a look below.',
  },
};

function stageOf(b: ServerBookingListItem): Stage {
  if (b.delivered_at) return 2;
  if (b.status === 'confirmed' || b.status === 'completed') return 1;
  return 0; // pending: paid, waiting for an editor to accept
}

/**
 * The package as the client bought it.
 *
 * The tier stored on the order is a config KEY (`photos_1_5`), not a label —
 * title-casing it produced "Photos_1_5" on screen. REMOTE_PACKAGES already
 * holds the names shown at purchase, so the tracker reads the same table the
 * client chose from and the two screens say the same words.
 */
function packageLabel(b: ServerBookingListItem): string {
  const kind =
    b.media_kind === 'video' ? 'Video edit' : b.media_kind === 'both' ? 'Photo + video' : 'Photo edit';
  const tier = b.pricing_snapshot?.remote_tier;
  if (!tier) return kind;
  const packages = REMOTE_PACKAGES[b.media_kind as keyof typeof REMOTE_PACKAGES] ?? [];
  const named = packages.find((p) => p.tier === tier)?.name;
  // An unknown key means the admin added a tier this build predates. Show the
  // kind alone rather than a raw key — never invent a name for it.
  return named ? `${kind} — ${named}` : kind;
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? `today by ${time}` : `${day} by ${time}`;
}

export default function OrderTracker() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reduceMotion = useReduceMotion();

  // Three states: null+loading, null+error, data. A missing booking is its
  // own state (notFound) — "we couldn't find it" is different from "the
  // request failed", and neither may look like a normal order.
  const [data, setData] = React.useState<OrderData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(false);
        setNotFound(false);
      }
      const api = await import('../../../lib/api');
      if (!api.apiConfigured) {
        setLoading(false);
        setError(true);
        return;
      }
      const bookings = await api.fetchMyBookings();
      if (!bookings) {
        // Background refreshes keep showing the data they have; only a
        // foreground load may declare failure.
        if (!silent) {
          setLoading(false);
          setError(true);
        }
        return;
      }
      const booking = bookings.find((b) => b.id === id);
      if (!booking) {
        setLoading(false);
        setData(null);
        setNotFound(true);
        return;
      }
      // Config, files and the editor's name load alongside; none of them may
      // block the order itself, so failures degrade the row, not the screen.
      const [configRes, media, threadsRes, revisionsRes] = await Promise.all([
        api.apiRequest<{ config: Record<string, unknown> }>('/v1/config'),
        api.fetchMediaListingApi(String(id)),
        api.apiRequest<{ threads: { booking_id: string; other_name: string; other_avatar: string | null }[] }>(
          '/v1/messages/threads',
        ),
        api.apiRequest<{ revisions: unknown[] }>(`/v1/bookings/${id}/revisions`),
      ]);
      const w = (configRes?.config?.['delivery_windows'] ?? {}) as {
        standard_hours?: number;
        rush_hours?: number;
      };
      const thread = threadsRes?.threads?.find((t) => t.booking_id === id);
      setData({
        booking,
        windows: { standardHours: w.standard_hours ?? 24, rushHours: w.rush_hours ?? 6 },
        media,
        editor: thread ? { name: thread.other_name, avatar: thread.other_avatar } : null,
        revisionsUsed: revisionsRes?.revisions?.length ?? 0,
      });
      setLoading(false);
      setError(false);
    },
    [id],
  );

  // Live without reopening: refetch on focus, poll while the screen is open
  // and the app is foregrounded. (bookings isn't in the realtime publication,
  // so polling is the honest mechanism here.)
  useFocusEffect(
    React.useCallback(() => {
      load();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') load(true);
      }, 25_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  // ---- Derived ----
  const b = data?.booking;
  const stage: Stage = b ? stageOf(b) : 0;
  const cancelled = b?.status === 'cancelled';
  const rush = (b?.pricing_snapshot?.addons?.rush_usd ?? 0) > 0;
  const windowHours = data ? (rush ? data.windows.rushHours : data.windows.standardHours) : 24;
  const dueAt =
    b?.created_at != null
      ? new Date(new Date(b.created_at).getTime() + windowHours * 3600_000).toISOString()
      : null;
  const overdue = dueAt != null && !b?.delivered_at && Date.now() > new Date(dueAt).getTime();
  const shortId = `SN-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  // Progress line: one shared value driven by the real stage; animates when
  // the stage advances mid-session (the poll picks it up).
  const progress = useSharedValue(stage / 2);
  React.useEffect(() => {
    progress.value = reduceMotion ? stage / 2 : withTiming(stage / 2, { duration: 600 });
  }, [stage, reduceMotion, progress]);
  const lineStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const enter = (order: number) =>
    reduceMotion ? undefined : FadeInUp.duration(320).delay(order * 70);

  // ---- The three fetch states ----
  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Your order" />
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.yellowDark} />
          <Text style={styles.stateSub}>Loading your order…</Text>
        </View>
      </View>
    );
  }
  if (error || !data || !b) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Your order" />
        <View style={styles.centerFill}>
          <Text style={styles.stateTitle}>{notFound ? 'Order not found' : "Couldn't load your order"}</Text>
          <Text style={styles.stateSub}>
            {notFound
              ? "This order isn't on your account. If you think that's wrong, contact hello@snaptcarib.app."
              : 'Check your connection and try again — your order is safe.'}
          </Text>
          {!notFound && (
            <Pressable onPress={() => load()} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  const copy = STAGE_COPY[stage];
  const files = data.media?.source_count ?? null;
  const freeLeft = Math.max(0, 1 - data.revisionsUsed);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your order" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Animated.View entering={enter(0)} style={styles.metaRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Short id a person can read out loud; tap copies the full one. */}
            <Pressable
              onPress={() => {
                Clipboard.setString(String(id));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              hitSlop={8}
            >
              <Text style={styles.orderId}>
                Order {shortId} {copied ? '· copied' : ''}
              </Text>
            </Pressable>
            <Text style={styles.eta}>
              {cancelled
                ? 'Order cancelled'
                : stage === 2
                  ? 'Ready to download'
                  : overdue
                    ? "Running behind — we're on it"
                    : dueAt
                      ? `Est. delivery ${formatDeadline(dueAt)}`
                      : 'Est. delivery pending'}
            </Text>
          </View>
          <Pressable onPress={() => router.push('/help/report')} style={styles.reportChip}>
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
              <Path d="M12 4l8.5 15h-17L12 4z" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinejoin="round" />
              <Path d="M12 10v4M12 16.5h.01" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" />
            </Svg>
            <Text style={styles.reportChipLabel}>Report an issue</Text>
          </Pressable>
        </Animated.View>

        {cancelled ? (
          <Animated.View entering={enter(1)} style={styles.statusCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>This order was cancelled</Text>
              <Text style={styles.statusDesc}>
                If a refund applies it's on its way to your original payment method. Questions —
                hello@snaptcarib.app or Report an issue above.
              </Text>
            </View>
          </Animated.View>
        ) : (
          <>
            {/* Stepper — driven by the booking row, animates on change. */}
            <Animated.View entering={enter(1)} style={styles.stepperCard}>
              <View style={styles.track}>
                <View style={styles.trackLine} />
                <Animated.View style={[styles.trackLineDone, lineStyle]} />
                <View style={styles.trackDots}>
                  {([0, 1, 2] as Stage[]).map((i) => (
                    <View key={i} style={[styles.dot, stage >= i ? styles.dotDone : styles.dotIdle]}>
                      {stage > i || (stage === 2 && i === 2) ? (
                        <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                          <Path d="M5 13l4 4L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      ) : (
                        <View style={[styles.innerDot, stage === i && { backgroundColor: colors.ink }]} />
                      )}
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.stepLabels}>
                <Text style={[styles.stepLabel, styles.stepLabelActive]}>Received</Text>
                <Text style={[styles.stepLabel, { textAlign: 'center' }, stage >= 1 && styles.stepLabelActive]}>
                  In progress
                </Text>
                <Text style={[styles.stepLabel, { textAlign: 'right' }, stage >= 2 && styles.stepLabelActive]}>
                  Ready
                </Text>
              </View>
            </Animated.View>

            {/* Status card */}
            <Animated.View entering={enter(2)} style={styles.statusCard}>
              <View style={styles.statusIcon}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                  <Rect x="2.5" y="6.5" width="19" height="13" rx="3" stroke={colors.ink} strokeWidth={1.8} />
                  <Circle cx="12" cy="13" r="3.6" stroke={colors.ink} strokeWidth={1.8} />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>{copy.title}</Text>
                <Text style={styles.statusDesc}>{copy.desc}</Text>
                {stage < 2 && (
                  <View style={styles.timeChip}>
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.9} />
                      <Path d="M12 7.5V12l3 2" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" />
                    </Svg>
                    {/* Same number the header estimate is computed from. */}
                    <Text style={styles.timeChipLabel}>
                      {rush ? `Rush order — within ${windowHours} hours` : `Delivered within ${windowHours} hours`}
                    </Text>
                  </View>
                )}
              </View>
            </Animated.View>

            {/* Editor card — the real assigned editor, or nothing. Never a
                stand-in person. */}
            {data.editor && (
              <Animated.View entering={enter(3)} style={styles.creatorCard}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.creatorName}>{data.editor.name.split(' ')[0]}</Text>
                  <Text style={styles.creatorRole}>Your editor</Text>
                  <Text style={styles.creatorSub}>
                    {stage === 2
                      ? 'Delivered your edit — message them any time.'
                      : stage === 1
                        ? 'Working on your edit right now.'
                        : 'Will pick up your files shortly.'}
                  </Text>
                </View>
              </Animated.View>
            )}

            {/* Order details — snapshot + real file count. */}
            <Animated.View entering={enter(4)}>
              <Text style={styles.sectionTitle}>Order details</Text>
              <View style={styles.detailsCard}>
                <DetailRow label="Package" value={packageLabel(b)} />
                {rush && <DetailRow label="Delivery" value={`Rush (${data.windows.rushHours}h)`} />}
                <DetailRow
                  label="Files uploaded"
                  value={files == null ? '—' : String(files)}
                  last
                />
              </View>
            </Animated.View>

            {/* What happens next */}
            <Animated.View entering={enter(5)}>
              <Text style={styles.sectionTitle}>What happens next</Text>
              <View style={styles.nextCard}>
                <View style={styles.nextIcon}>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 3a6 6 0 00-6 6c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6a6 6 0 00-6-6z" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinejoin="round" />
                    <Path d="M10 20a2 2 0 004 0" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nextText}>
                    We'll notify you the moment your edit is ready. You'll be able to preview
                    everything in the app and download in full quality.
                  </Text>
                  {stage < 2 && dueAt && !overdue && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 }}>
                      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <Circle cx="12" cy="12" r="9" stroke="#8A8377" strokeWidth={1.8} />
                        <Path d="M12 7.5V12l3 2" stroke="#8A8377" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                      <Text style={styles.nextEta}>Due {formatDeadline(dueAt)}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Animated.View>
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {!cancelled && stage === 2 && (
        <View style={styles.footer}>
          <Pressable onPress={() => router.push(`/order/${id}/delivery`)} style={styles.cta}>
            <Text style={styles.ctaLabel}>View & download</Text>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
          <Pressable onPress={() => router.push(`/order/${id}/delivery`)} style={styles.reviseBtn}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path d="M4 12a8 8 0 018-8c2.8 0 5.2 1.4 6.6 3.6M20 12a8 8 0 01-8 8c-2.8 0-5.2-1.4-6.6-3.6M18 4.5v3.2h-3.2M6 19.5v-3.2h3.2" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.reviseLabel}>Request a revision</Text>
            <Text style={styles.reviseCount}>
              {freeLeft > 0 ? `${freeLeft} free left` : 'extra rounds paid'}
            </Text>
          </Pressable>
        </View>
      )}

      {!cancelled && (
        <Pressable onPress={() => router.push(`/(app)/messages/${id}` as never)} style={[styles.chatFab, stage < 2 && { bottom: 40 }]}>
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H10l-4.5 3.5V15H6a2 2 0 01-2-2V6z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
          </Svg>
        </Pressable>
      )}
    </View>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, !last && { marginBottom: 10 }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 12 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateSub: { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    marginTop: 8,
    height: 44,
    paddingHorizontal: 26,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, gap: 10 },
  orderId: { fontSize: 12, color: colors.grey },
  eta: { fontSize: 13.5, fontWeight: '700', color: colors.ink, marginTop: 2 },
  reportChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  reportChipLabel: { fontSize: 10, fontWeight: '800', color: colors.yellowDark },
  stepperCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  track: { justifyContent: 'center' },
  trackLine: {
    position: 'absolute',
    left: 13,
    right: 13,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#EFEDE7',
  },
  trackLineDone: {
    position: 'absolute',
    left: 13,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.yellow,
    maxWidth: '93%',
  },
  trackDots: { flexDirection: 'row', justifyContent: 'space-between' },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.yellow },
  dotIdle: { backgroundColor: '#EFEDE7' },
  innerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C6C3BC' },
  stepLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  stepLabel: { fontSize: 11, fontWeight: '600', color: '#B4B1AA', width: 70 },
  stepLabelActive: { color: colors.ink, fontWeight: '800' },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  statusDesc: { fontSize: 13, color: colors.grey, marginTop: 3, lineHeight: 18 },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 9,
  },
  timeChipLabel: { fontSize: 9.5, fontWeight: '800', color: '#8A6800' },
  creatorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    paddingHorizontal: 16,
    marginTop: 16,
    shadowColor: colors.ink,
    shadowOpacity: 0.09,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  creatorName: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  creatorRole: { fontSize: 12, color: colors.greyWarm, fontWeight: '600', marginTop: 1 },
  creatorSub: { fontSize: 12.5, color: colors.grey, marginTop: 6, lineHeight: 17 },
  sectionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 22, marginBottom: 12 },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    paddingHorizontal: 18,
    shadowColor: colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailLabel: { fontSize: 13.5, color: colors.grey },
  detailValue: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    paddingHorizontal: 18,
    shadowColor: colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  nextIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { fontSize: 13.5, color: '#5C574E', lineHeight: 20 },
  nextEta: { fontSize: 12, fontWeight: '700', color: '#8A7530' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 10,
  },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  reviseBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E3DA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  reviseLabel: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
  reviseCount: { fontSize: 9.5, fontWeight: '800', color: colors.greyWarm },
  chatFab: {
    position: 'absolute',
    right: 20,
    bottom: 120,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
