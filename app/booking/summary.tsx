import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { Avatar, Card, Divider, InfoBanner, VerifiedBadge } from '../../components/ui/Misc';
import { OccasionIcon } from '../../components/ui/Icons';
import { DURATIONS } from '../../lib/mock/data';
import { creatorById, useAuth, useBookings } from '../../lib/store';
import {
  CANCEL_FULL_REFUND_HOURS,
  CLIENT_SERVICE_FEE_RATE,
  formatMoney,
} from '../../lib/constants/business';
import { colors, spacing } from '../../lib/theme';

export default function OrderSummary() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { draft, confirmDraft } = useBookings();
  const creator = creatorById(draft.creatorId);
  const duration = DURATIONS.find((d) => d.hours === draft.durationHours);

  const base = duration?.priceUsd ?? 0;
  const serviceFee = base * CLIENT_SERVICE_FEE_RATE;
  const total = base + serviceFee;

  const when =
    draft.date && draft.time
      ? new Date(`${draft.date}T${draft.time}:00`).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }) + ` · ${draft.time}`
      : '—';

  return (
    <View style={styles.root}>
      <ScreenHeader title="Order summary" />
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
                ★ {creator.rating.toFixed(1)} · {creator.sessions} sessions
              </Text>
            </View>
          </Card>
        )}

        <Card style={{ marginTop: 12, gap: 13 }}>
          <Row label="Occasion">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              {draft.occasion && <OccasionIcon occasion={draft.occasion} size={17} />}
              <Text style={styles.value}>{draft.occasion ?? '—'}</Text>
            </View>
          </Row>
          <Row label="When">
            <Text style={styles.value}>{when}</Text>
          </Row>
          <Row label="Where">
            <Text style={styles.value}>
              {draft.meetingPoint ? `${draft.meetingPoint}, ` : ''}
              {draft.area ?? '—'}
            </Text>
          </Row>
          <Row label="Package">
            <Text style={styles.value}>
              {duration?.label ?? '—'} ·{' '}
              {draft.mediaKind === 'both'
                ? 'Photos + video'
                : draft.mediaKind === 'photo'
                  ? 'Photos'
                  : 'Video'}
            </Text>
          </Row>
        </Card>

        <Card style={{ marginTop: 12, gap: 12 }}>
          <PriceRow label="Session" value={formatMoney(base, currency)} />
          <PriceRow
            label={`Service fee (${(CLIENT_SERVICE_FEE_RATE * 100).toFixed(0)}%)`}
            value={formatMoney(serviceFee, currency)}
          />
          <Divider />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(total, currency)}</Text>
          </View>
        </Card>

        <View style={{ marginTop: 14 }}>
          <InfoBanner
            text={`Free cancellation until ${CANCEL_FULL_REFUND_HOURS} hours before your session. See the cancellation policy for the full fee schedule.`}
          />
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title={`Confirm & pay ${formatMoney(total, currency)}`}
          onPress={() => {
            const booking = confirmDraft(base);
            router.dismissAll();
            router.replace(`/bookings/${booking.id}`);
          }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{children}</View>
    </View>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
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
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  totalValue: { fontSize: 19, fontWeight: '800', color: colors.ink },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
  },
});
