import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../../../components/ui/SlideToConfirm';
import { creatorById, hoursUntil, useAuth, useBookings } from '../../../../lib/store';
import { apiConfigured, cancelBookingApi } from '../../../../lib/api';
import {
  CANCEL_TIERS,
  cancelTierForHoursUntil,
  CLIENT_SERVICE_FEE_RATE,
  formatCharge,
  formatMoney,
  USD_PROCESSING_NOTE,
} from '../../../../lib/constants/business';
import { colors, spacing, insetBottom } from '../../../../lib/theme';

export default function CancelConfirm() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useAuth((s) => s.currency);
  const { bookings, cancelBooking } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const creator = creatorById(booking?.creatorId ?? null);
  const [error, setError] = React.useState<string | null>(null);

  if (!booking) return null;

  const confirmCancel = async () => {
    if (apiConfigured) {
      // Authoritative fee computation happens server-side at time of action.
      const result = await cancelBookingApi(booking.id);
      if (result && 'error' in result) {
        setError(result.error);
        return false; // slider unlocks so the user can retry
      }
      // result null = API unreachable; fall through to the local mock path.
    }
    cancelBooking(booking.id);
    router.replace(`/bookings/${booking.id}/cancel-done`);
    return true;
  };

  // Displayed tier is advisory — the authoritative fee computation runs
  // server-side at time of action (handoff §8). The 8% service fee is
  // non-refundable at every tier (Don, 2026-07-27); the charge rate applies
  // to the session cost only.
  const remote = booking.type === 'remote';
  // Never accepted (offer window still open / no editor): full refund
  // including the service fee (Don, 2026-07-27). Confirmed bookings keep
  // the tier rules with the fee non-refundable.
  const neverAccepted = booking.status === 'pending' || remote;
  const h = hoursUntil(booking.scheduledAt);
  const tier = cancelTierForHoursUntil(h);
  const info = CANCEL_TIERS[tier];
  const serviceFee = booking.priceUsd * CLIENT_SERVICE_FEE_RATE;
  const charge = neverAccepted ? 0 : booking.priceUsd * info.chargeRate;
  const refund = neverAccepted ? booking.priceUsd + serviceFee : booking.priceUsd - charge;

  const free = neverAccepted || tier === 'over48h';
  const noticeLabel = h >= 48 ? `${Math.round(h / 24)} days' notice` : `${Math.max(Math.round(h), 0)} hrs' notice`;
  const when = new Date(booking.scheduledAt);

  const banner = free
    ? {
        style: styles.bannerFree,
        title: 'Full refund — no charge',
        titleColor: '#1B7A4B',
        bodyColor: '#2E7D43',
        body: neverAccepted
          ? remote
            ? 'No editor has started on this order, so cancelling is free and your full payment — service fee included — is returned to your original payment method.'
            : 'No creator has accepted this booking yet, so cancelling is free and your full payment — service fee included — is returned to your original payment method.'
          : "You're outside the 48-hour window, so this cancellation is free and your full payment is returned to your original payment method. The 8% service fee is non-refundable.",
      }
    : tier === 'between24and48h'
      ? {
          style: styles.bannerPartial,
          title: '50% charge applies',
          titleColor: '#8A6400',
          bodyColor: '#8A6800',
          body: `You're inside the 24–48 hour window, so half the session cost (${formatCharge(charge, currency)}) is charged. ${formatCharge(refund, currency)} is returned to your original payment method. The service fee is non-refundable.`,
        }
      : {
          style: styles.bannerFull,
          title: 'Full charge applies',
          titleColor: '#B0392B',
          bodyColor: '#A04A3F',
          body: `You're inside 24 hours of the session, so the full session cost is charged and no refund is issued. The service fee is non-refundable. Rescheduling may be cheaper if your plans changed.`,
        };

  return (
    <View style={styles.root}>
      <ScreenHeader title={remote ? 'Cancel order' : 'Cancel booking'} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Session summary */}
        <View style={styles.sessionCard}>
          <Text style={styles.overline}>YOUR SESSION</Text>
          <Text style={styles.sessionWhen}>
            {when.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} ·{' '}
            {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <Text style={styles.sessionMeta}>
            {remote ? 'Remote edit order' : `${booking.occasion} session`}
            {creator ? ` with ${creator.name.split(' ')[0]}` : ''}
            {!remote ? ` · ${noticeLabel}` : ''}
          </Text>
          <View style={styles.sessionDivider} />
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>Session cost</Text>
            <Text style={styles.costValue}>{formatMoney(booking.priceUsd, currency)}</Text>
          </View>
        </View>

        {/* Outcome banner */}
        <View style={[styles.banner, banner.style]}>
          <Text style={[styles.bannerTitle, { color: banner.titleColor }]}>{banner.title}</Text>
          <Text style={[styles.bannerBody, { color: banner.bodyColor }]}>{banner.body}</Text>
        </View>

        {/* Policy explainer */}
        {!remote && (
          <View style={styles.policyCard}>
            <Text style={styles.policyTitle}>How our cancellation policy works</Text>
            <Text style={styles.policyBody}>
              Cancellations made more than 48 hours before your session are fully refunded. Inside 48
              hours, a partial or full charge applies depending on the notice given.
            </Text>
            <View style={styles.policyDivider} />
            <PolicyRow label="More than 48 hours out" value="Free" active={tier === 'over48h' || neverAccepted} />
            <PolicyRow label="24–48 hours out" value="50% charge" active={!neverAccepted && tier === 'between24and48h'} />
            <PolicyRow label="Under 24 hours" value="Full charge" active={!neverAccepted && tier === 'under24h'} />
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        <SlideToConfirm
          label={remote ? 'Slide to cancel order' : 'Slide to cancel booking'}
          value={formatMoney(free ? 0 : charge, 'USD')}
          valueLabel="Cancellation charge (USD)"
          onConfirm={confirmCancel}
        />
        <Text style={styles.usdNote}>
          {!free && currency === 'XCD' ? `≈ ${formatMoney(charge, 'XCD')} · ` : ''}
          {USD_PROCESSING_NOTE}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.keepBtn}>
          <Text style={styles.keepLabel}>Keep my booking</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PolicyRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <View style={styles.policyRow}>
      <Text style={[styles.policyRowLabel, active && styles.policyRowActive]}>{label}</Text>
      <Text style={[styles.policyRowValue, active && styles.policyRowActive]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  sessionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  overline: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, color: '#A8A29A' },
  sessionWhen: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, marginTop: 6 },
  sessionMeta: { fontSize: 12, color: colors.greyWarm, fontWeight: '600', marginTop: 3 },
  sessionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#EAE6DD', marginVertical: 12 },
  costRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  costLabel: { fontSize: 13, color: colors.grey, fontWeight: '600' },
  costValue: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  banner: { borderRadius: 16, padding: 15, marginTop: 14, borderWidth: 1 },
  bannerFree: { backgroundColor: '#E6F7EE', borderColor: '#C7EBD6' },
  bannerPartial: { backgroundColor: '#FFF4D6', borderColor: '#F2E3B8' },
  bannerFull: { backgroundColor: '#FDECEA', borderColor: '#F6D5D2' },
  bannerTitle: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },
  bannerBody: { fontSize: 12.5, lineHeight: 18.5, marginTop: 6, fontWeight: '600' },
  policyCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  policyTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  policyBody: { fontSize: 12.5, color: colors.grey, lineHeight: 18.5, marginTop: 7 },
  policyDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#EAE6DD', marginVertical: 12 },
  policyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  policyRowLabel: { fontSize: 12.5, color: colors.grey, fontWeight: '600' },
  policyRowValue: { fontSize: 12.5, color: colors.grey, fontWeight: '600' },
  policyRowActive: { color: colors.ink, fontWeight: '800' },
  error: { fontSize: 13, color: colors.error, fontWeight: '600', marginTop: 14 },
  usdNote: { fontSize: 11, color: colors.grey, lineHeight: 15.5, textAlign: 'center' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 10,
  },
  keepBtn: {
    height: 52,
    borderRadius: 15,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
