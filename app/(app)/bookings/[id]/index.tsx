import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useAuth((s) => s.currency);
  const booking = useBookings((s) => s.bookings.find((b) => b.id === id));

  if (!booking) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Booking" />
        <Text style={{ padding: 22, color: colors.grey }}>Booking not found.</Text>
      </View>
    );
  }

  const creator = creatorById(booking.creatorId);
  const d = new Date(booking.scheduledAt);
  const hrs = hoursUntil(booking.scheduledAt);
  const tier = cancelTierForHoursUntil(hrs);
  const active = booking.status === 'confirmed';
  const sessionWindow = hrs <= 0 && hrs > -booking.durationHours && active;
  const graceElapsed = hrs * 60 <= -NO_SHOW_GRACE_MINUTES;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Booking detail" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
