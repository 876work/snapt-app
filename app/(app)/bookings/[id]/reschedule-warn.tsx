import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { Button } from '../../../../components/ui/Button';
import { Card, InfoBanner } from '../../../../components/ui/Misc';
import { hoursUntil, useAuth, useBookings } from '../../../../lib/store';
import {
  cancelTierForHoursUntil,
  CLIENT_SERVICE_FEE_RATE,
  formatMoney,
} from '../../../../lib/constants/business';
import { colors, spacing } from '../../../../lib/theme';

// Rescheduling in a paid window carries the same charge as cancelling in
// that window (§5): 50% at 24–48h. The 6–24h band is a §5 policy gap,
// implemented as 100% pending Don's confirmation — mirror of server fees.ts.
export default function RescheduleWarn() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useAuth((s) => s.currency);
  const booking = useBookings((s) => s.bookings.find((b) => b.id === id));
  if (!booking) return null;

  const tier = cancelTierForHoursUntil(hoursUntil(booking.scheduledAt));
  const rate = tier === 'between24and48h' ? 0.5 : 1;
  const total = booking.priceUsd * (1 + CLIENT_SERVICE_FEE_RATE);
  const charge = total * rate;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Heads up — reschedule fee" />
      <View style={styles.body}>
        <InfoBanner
          tone="error"
          text={
            tier === 'between24and48h'
              ? 'Your session is between 24 and 48 hours away. Rescheduling now carries the same 50% charge as cancelling in this window.'
              : 'Your session is less than 24 hours away. Rescheduling now carries the same 100% charge as cancelling in this window — keeping your booking may be the better option.'
          }
        />
        <Card style={{ gap: 12, marginTop: 14 }}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Reschedule charge</Text>
            <Text style={styles.rowValue}>{formatMoney(charge, currency)}</Text>
          </View>
        </Card>
        <View style={{ gap: 10, marginTop: 24 }}>
          <Button
            title="Continue anyway"
            onPress={() => router.replace(`/bookings/${booking.id}/reschedule`)}
          />
          <Button title="Keep my booking" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 12.5, color: colors.grey, fontWeight: '600' },
  rowValue: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
