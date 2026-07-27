import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../../../components/ui/SlideToConfirm';
import { Card, InfoBanner } from '../../../../components/ui/Misc';
import { hoursUntil, useAuth, useBookings } from '../../../../lib/store';
import { apiConfigured, cancelBookingApi } from '../../../../lib/api';
import {
  CANCEL_TIERS,
  cancelTierForHoursUntil,
  CLIENT_SERVICE_FEE_RATE,
  formatMoney,
} from '../../../../lib/constants/business';
import { colors, spacing } from '../../../../lib/theme';

export default function CancelConfirm() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useAuth((s) => s.currency);
  const { bookings, cancelBooking } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const [error, setError] = React.useState<string | null>(null);

  if (!booking) return null;

  const confirmCancel = async () => {
    if (apiConfigured) {
      // Authoritative fee computation happens server-side at time of action.
      const result = await cancelBookingApi(booking.id);
      if (result && 'error' in result) {
        setError(result.error);
        return;
      }
      // result null = API unreachable; fall through to the local mock path.
    }
    cancelBooking(booking.id);
    router.replace(`/bookings/${booking.id}/cancel-done`);
  };

  // Displayed tier is advisory — the authoritative fee computation must run
  // server-side at time of action (handoff §8).
  const tier = cancelTierForHoursUntil(hoursUntil(booking.scheduledAt));
  const info = CANCEL_TIERS[tier];
  const total = booking.priceUsd * (1 + CLIENT_SERVICE_FEE_RATE);
  const charge = total * info.chargeRate;
  const refund = total - charge;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Cancel this booking?" />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={{ gap: 12 }}>
          <Row label="Cancellation window" value={
            tier === 'over48h' ? 'More than 48 hrs before' : tier === 'between24and48h' ? '24–48 hrs before' : 'Less than 24 hrs before'
          } />
          <Row label="Policy" value={info.label} />
          <Row label="Charge" value={formatMoney(charge, currency)} />
          <Row label="Refund to you" value={formatMoney(refund, currency)} strong />
        </Card>
        <View style={{ marginTop: 14 }}>
          <InfoBanner
            tone={tier === 'over48h' ? 'gold' : 'error'}
            text={
              tier === 'over48h'
                ? "You're outside the fee window — cancelling now is free."
                : 'Cancelling this close to the session has a fee. Rescheduling may be cheaper if your plans changed.'
            }
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={{ marginTop: 26 }}>
          <SlideToConfirm label="Slide to cancel booking" danger onConfirm={confirmCancel} />
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontSize: 15 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 12.5, color: colors.grey, fontWeight: '600' },
  rowValue: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  error: { fontSize: 13, color: colors.error, fontWeight: '600', marginTop: 14 },
});
