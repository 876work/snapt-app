import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { Button } from '../../../../components/ui/Button';
import { Avatar, Card, InfoBanner, VerifiedBadge } from '../../../../components/ui/Misc';
import { OccasionIcon } from '../../../../components/ui/Icons';
import { creatorById, hoursUntil, useAuth, useBookings } from '../../../../lib/store';
import {
  cancelTierForHoursUntil,
  CANCEL_TIERS,
  formatMoney,
  NO_SHOW_GRACE_MINUTES,
  RESCHEDULE_DISABLED_UNDER_HOURS,
} from '../../../../lib/constants/business';
import { colors, spacing } from '../../../../lib/theme';

export default function BookingDetail() {
  const router = useRouter();
  const { id, paid } = useLocalSearchParams<{ id: string; paid?: string }>();
  const currency = useAuth((s) => s.currency);
  const booking = useBookings((s) => s.bookings.find((b) => b.id === id));
  const justPaid = paid === '1';

  /**
   * This screen read ONLY the local store, which is hydrated by the Bookings
   * list and Home. A booking created seconds earlier by the Stripe webhook is
   * not in it yet, so someone who had just paid was shown "Booking not found"
   * — which reads as their money vanishing. The row existed the whole time;
   * the client simply had not fetched it.
   *
   * So: when the booking is missing, go and ask the server instead of
   * asserting it does not exist. Poll while we do, because a webhook landing
   * a moment late is a normal race, not an error.
   */
  const [checking, setChecking] = React.useState(!booking);
  const [gaveUp, setGaveUp] = React.useState(false);

  React.useEffect(() => {
    if (booking) {
      setChecking(false);
      return;
    }
    let stop = false;
    // A paid arrival gets a longer window than a cold deep link: the webhook
    // is already in flight and worth waiting for.
    const deadline = Date.now() + (justPaid ? 45_000 : 8_000);
    const tick = async () => {
      if (stop) return;
      const { apiConfigured, fetchMyBookings, toClientBooking } = await import('../../../../lib/api');
      if (!apiConfigured) {
        if (!stop) { setChecking(false); setGaveUp(true); }
        return;
      }
      const rows = await fetchMyBookings();
      if (stop) return;
      if (rows) {
        useBookings.getState().hydrateBookings(rows.map(toClientBooking));
        if (rows.some((b) => b.id === id)) return; // the selector re-renders us
      }
      if (Date.now() > deadline) { setChecking(false); setGaveUp(true); return; }
      setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [booking, id, justPaid]);

  if (!booking) {
    // Paid and still waiting: say what is true — the money arrived and the
    // booking is being written — never "not found".
    if (checking) {
      return (
        <View style={styles.root}>
          <ScreenHeader title={justPaid ? 'Payment received' : 'Booking'} />
          <View style={styles.stateWrap}>
            <ActivityIndicator color={colors.yellowDark} />
            <Text style={styles.stateTitle}>
              {justPaid ? 'Confirming your booking…' : 'Loading your booking…'}
            </Text>
            {justPaid && (
              <Text style={styles.stateBody}>
                Your payment went through. We're just finishing the booking — this takes a few
                seconds. You don't need to pay again.
              </Text>
            )}
          </View>
        </View>
      );
    }
    // Genuinely absent. Even here there is a way forward, not a dead end.
    return (
      <View style={styles.root}>
        <ScreenHeader title="Booking" />
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>
            {justPaid ? "We couldn't confirm this booking yet" : 'Booking not found'}
          </Text>
          <Text style={styles.stateBody}>
            {justPaid
              ? "Your payment went through — do NOT pay again. It should appear in Bookings shortly. If it doesn't, contact hello@snaptcarib.app and quote this page."
              : "This booking isn't on your account. It may have been cancelled, or opened from an old link."}
          </Text>
          <Button title="Go to Bookings" onPress={() => router.replace('/(app)/bookings')} />
        </View>
      </View>
    );
  }

  const creator = creatorById(booking.creatorId);
  const d = new Date(booking.scheduledAt);
  const hrs = hoursUntil(booking.scheduledAt);
  const tier = cancelTierForHoursUntil(hrs);
  const active = booking.status === 'confirmed';
  // 'pending' now means the assigned creator hasn't accepted yet (15-min
  // offer window) — the booking is only confirmed once they say yes.
  const awaitingAccept = booking.status === 'pending';
  const sessionWindow = hrs <= 0 && hrs > -booking.durationHours && active;
  const graceElapsed = hrs * 60 <= -NO_SHOW_GRACE_MINUTES;

  const when = d.toLocaleString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  });

  return (
    <View style={styles.root}>
      <ScreenHeader title="Booking detail" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Post-payment confirmation, in place of a separate success screen:
            the booking they just paid for IS the confirmation, with what
            happens next stated rather than left to be inferred. */}
        {justPaid && (
          <View style={styles.paidCard}>
            <Text style={styles.paidTitle}>Payment received — you're booked</Text>
            <Text style={styles.paidLine}>
              {booking.occasion}
              {booking.type === 'remote' ? ' · remote edit' : ''} · {when}
            </Text>
            {booking.type !== 'remote' && (booking.meetingPoint || booking.area) ? (
              <Text style={styles.paidLine}>{booking.meetingPoint ?? booking.area}</Text>
            ) : null}
            <Text style={styles.paidNext}>
              {awaitingAccept
                ? "We're matching you with a creator now — you'll get a notification the moment they accept."
                : "Your creator is confirmed. We'll remind you before the session, and you can message them any time."}
            </Text>
          </View>
        )}
        {creator && (
          <Card style={styles.creatorCard}>
            <Avatar tint={creator.tint} name={creator.name} size={50} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{creator.name}</Text>
                {creator.verified && <VerifiedBadge />}
              </View>
              <Text style={styles.meta}>
                {creator.rating != null
                  ? `★ ${creator.rating.toFixed(1)} · ${creator.sessions} sessions`
                  : 'New creator'}
              </Text>
            </View>
          </Card>
        )}

        <Card style={{ marginTop: 12, gap: 13 }}>
          <DetailRow label="Occasion">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <OccasionIcon occasion={booking.occasion} size={17} />
              <Text style={styles.value}>{booking.occasion}</Text>
            </View>
          </DetailRow>
          <DetailRow label="When">
            <Text style={styles.value}>
              {d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} ·{' '}
              {d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </Text>
          </DetailRow>
          <DetailRow label="Where">
            <Text style={styles.value}>
              {booking.meetingPoint ? `${booking.meetingPoint}, ` : ''}
              {booking.area}
            </Text>
          </DetailRow>
          <DetailRow label="Package">
            <Text style={styles.value}>
              {booking.durationHours}hr ·{' '}
              {booking.mediaKind === 'both' ? 'Photos + video' : booking.mediaKind === 'photo' ? 'Photos' : 'Video'}
            </Text>
          </DetailRow>
          <DetailRow label="Total paid">
            <Text style={styles.value}>{formatMoney(booking.priceUsd * 1.08, currency)}</Text>
          </DetailRow>
        </Card>

        {awaitingAccept && (
          <>
            <View style={{ marginTop: 14 }}>
              <InfoBanner text="Waiting for your creator to accept — most offers are answered within 15 minutes. If they can't make it, we'll match you with the next available creator automatically." />
            </View>
            <View style={{ gap: 10, marginTop: 18 }}>
              <Button
                title="Cancel booking"
                variant="ghost"
                onPress={() => router.push(`/bookings/${booking.id}/cancel`)}
              />
            </View>
          </>
        )}

        {active && (
          <>
            <View style={{ marginTop: 14 }}>
              <InfoBanner
                text={
                  tier === 'over48h'
                    ? 'Cancelling now: session cost refunded in full (service fee non-refundable).'
                    : tier === 'between24and48h'
                      ? `Cancelling now: ${CANCEL_TIERS.between24and48h.label} applies (24–48 hrs before session).`
                      : `Cancelling now: ${CANCEL_TIERS.under24h.label} (less than 24 hrs before session).`
                }
                tone={tier === 'over48h' ? 'gold' : 'error'}
              />
            </View>

            {sessionWindow && (
              <View style={{ marginTop: 10 }}>
                <InfoBanner
                  tone={graceElapsed ? 'error' : 'gold'}
                  text={
                    graceElapsed
                      ? "The 15-minute grace period has passed. If your creator hasn't arrived, you can report a no-show."
                      : `Session time — your creator has a ${NO_SHOW_GRACE_MINUTES}-minute grace window before a no-show can be reported.`
                  }
                />
              </View>
            )}

            <View style={{ gap: 10, marginTop: 18 }}>
              {booking.type === 'in-person' && (
                <Button
                  title="Session day — track & check in"
                  onPress={() => router.push(`/session/${booking.id}`)}
                />
              )}
              {booking.type === 'remote' && (
                <Button
                  title="Track your order"
                  onPress={() => router.push(`/order/${booking.id}`)}
                />
              )}
              {sessionWindow && (
                <Button
                  title="Creator didn't show up"
                  variant="ghost"
                  onPress={() => router.push(`/bookings/${booking.id}/no-show-client`)}
                />
              )}
              <Button
                title="Reschedule"
                variant="ghost"
                onPress={() => {
                  if (hrs < RESCHEDULE_DISABLED_UNDER_HOURS) {
                    // Under 24h: reschedule is disabled entirely — cancel or
                    // contact support (Don, 2026-07-27).
                    router.push(`/bookings/${booking.id}/reschedule-blocked`);
                  } else if (tier !== 'over48h') {
                    // Only the 24–48h band reaches the fee warning.
                    router.push(`/bookings/${booking.id}/reschedule-warn`);
                  } else {
                    router.push(`/bookings/${booking.id}/reschedule`);
                  }
                }}
              />
              <Button
                title="Cancel booking"
                variant="ghost"
                onPress={() => router.push(`/bookings/${booking.id}/cancel`)}
              />
            </View>
          </>
        )}

        {booking.status === 'disputed' && (
          <View style={{ marginTop: 14, gap: 10 }}>
            <InfoBanner
              tone="error"
              text="A dispute is open on this booking. You have 72 hours from when it opened to add your evidence."
            />
            <Button title="Add evidence" onPress={() => router.push(`/bookings/${booking.id}/evidence`)} />
          </View>
        )}

        {booking.status === 'completed' && (
          <View style={{ marginTop: 18 }}>
            <Button title="View delivery" onPress={() => router.push(`/order/${booking.id}/delivery`)} />
          </View>
        )}
        <View style={{ height: 130 }} />
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 12 },
  paidCard: {
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    gap: 3,
  },
  paidTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  paidLine: { fontSize: 12.5, color: '#6E5B23', lineHeight: 18 },
  paidNext: { fontSize: 12.5, color: '#6E5B23', lineHeight: 18, marginTop: 5 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateBody: { fontSize: 13.5, color: colors.grey, textAlign: 'center', lineHeight: 20, marginBottom: 6 },
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  creatorCard: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 12, color: colors.grey, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 12.5, color: colors.grey, fontWeight: '600' },
  value: { fontSize: 13.5, fontWeight: '700', color: colors.ink, textAlign: 'right' },
});
