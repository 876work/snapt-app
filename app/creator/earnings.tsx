import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useAuth } from '../../lib/store';
import { formatMoney } from '../../lib/constants/business';
import type { CreatorFeeRate } from '../../lib/api';
import { colors } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';

// No mock fallback. A failed fetch used to render four invented payouts with
// real-looking amounts — wrong numbers on a money screen are worse than an
// error message.

interface PayoutRow {
  id: string;
  title: string;
  state: string;
  date: string;
  calc: string;
  amount: number;
}

const STATE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: '#FFF4D6', color: '#8A6800', label: 'PENDING' },
  available: { bg: '#E6F7EE', color: '#159A57', label: 'AVAILABLE' },
  paid: { bg: '#F1EEE7', color: '#8A8377', label: 'PAID' },
};

export default function CreatorEarnings() {
  // Set when a payout notification opened this screen — marks the row the
  // message was about instead of leaving them to match amounts by eye.
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const router = useRouter();
  const currency = useAuth((s) => s.currency);

  // Real payout states in API mode (held → Pending, available, paid_out);
  // mock rows otherwise. Held funds flip to available server-side once the
  // 7-day hold elapses.
  const [real, setReal] = React.useState<{
    rows: PayoutRow[];
    totals: { pending: number; available: number; paid_out: number };
    /** This creator's own rate, from the server. null = we don't know it. */
    fee: CreatorFeeRate | null;
  } | null>(null);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchEarnings }) => {
      if (!apiConfigured) return;
      fetchEarnings().then((data) => {
        if (!data) return;
        setReal({
          totals: data.totals,
          fee: data.fee ?? null,
          rows: data.payouts.map((p) => ({
            id: p.id,
            title: `Booking ${p.booking_id.slice(0, 8)}`,
            state: ['held', 'requested'].includes(p.status) ? 'pending' : p.status === 'paid_out' ? 'paid' : 'available',
            date:
              p.status === 'requested'
                ? 'Payout requested — being processed'
                :
              p.status === 'held' && p.hold_until
                ? `Clears ${new Date(p.hold_until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                : new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            calc: 'After platform fee',
            amount: Number(p.amount_usd),
          })),
        });
      });
    });
  }, []);

  const rows = real?.rows ?? [];
  // The creator's OWN rate. null until it arrives, and null forever in mock
  // mode or after a failed fetch — the card says so rather than inventing a
  // number, because a wrong fee on a money screen is worse than no fee.
  const fee = real?.fee ?? null;
  // Trailing zeros trimmed, so 0.325 prints "32.5%" rather than rounding to
  // a rate nobody is actually on.
  const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
  const pending = real?.totals.pending ?? 0;
  const available = real?.totals.available ?? 0;
  const paidOut = real?.totals.paid_out ?? 0;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Earnings" onBack={() => router.back()} />
      <ScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Balance card */}
        <View style={styles.balanceCard}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', gap: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.balLabel}>Pending</Text>
              <Text style={[styles.balValue, { color: '#FFCE4D' }]}>{formatMoney(pending, currency)}</Text>
            </View>
            <View style={styles.balDiv} />
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={styles.balLabel}>Available</Text>
              <Text style={[styles.balValue, { color: '#5BE39B' }]}>{formatMoney(available, currency)}</Text>
            </View>
            <View style={styles.balDiv} />
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={styles.balLabel}>Paid out</Text>
              <Text style={[styles.balValue, { color: 'rgba(255,255,255,0.82)' }]}>
                {formatMoney(paidOut, currency)}
              </Text>
            </View>
          </View>
          <Pressable onPress={() => router.push('/creator/cash-out')} style={styles.cashOutBtn}>
            <Text style={styles.cashOutLabel}>Cash out {formatMoney(available, currency)}</Text>
          </Pressable>
          {/* Holding window is a §6 open value — dispute-window conflict unresolved */}
          <Text style={styles.balNote}>
            Pending funds clear 7 days after delivery, once the client's dispute window closes.
          </Text>
        </View>

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>This week</Text>
            <Text style={styles.statValue}>{formatMoney(438.6, currency)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Jobs done</Text>
            <Text style={styles.statValue}>23</Text>
          </View>
        </View>

        {/* Platform fee — THIS creator's rate, resolved by the server. The
            promo treatment (strikethrough + chip) appears only for a creator
            who actually has a promo rate; it used to render for everyone. */}
        <View style={styles.feeCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ minWidth: 0 }}>
              <Text style={styles.statLabel}>Your platform fee</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                {fee == null ? (
                  <Text style={styles.feeUnknown}>—</Text>
                ) : fee.is_promo && fee.standard_rate != null ? (
                  <>
                    <Text style={styles.feeStd}>{pct(fee.standard_rate)}</Text>
                    <Text style={styles.feePromo}>{pct(fee.rate)}</Text>
                  </>
                ) : (
                  <Text style={styles.feeRate}>{pct(fee.rate)}</Text>
                )}
              </View>
            </View>
            {fee?.is_promo ? (
              <View style={styles.promoChip}>
                <Text style={styles.promoLabel}>Limited-time rate</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.feeNote}>
            {fee == null
              ? "We couldn't load your rate just now — reopen this screen to see it. Every amount above is already after the fee."
              : fee.is_promo && fee.standard_rate != null
                ? `You're keeping more of every job while this promo rate is active — normally ${pct(fee.standard_rate)}.`
                : 'Taken out of each job before your payout. Every amount above is what you keep.'}
          </Text>
        </View>

        {/* Recent payouts */}
        <Text style={styles.sectionTitle}>Recent payouts</Text>
        <View style={styles.list}>
          {rows.map((p, i) => {
            const st = STATE_STYLE[p.state];
            return (
              <View
                key={p.id}
                style={[
                  styles.payoutRow,
                  i < rows.length - 1 && styles.rowBorder,
                  p.id === highlight && styles.payoutHighlight,
                ]}
              >
                <View style={styles.payoutAvatar} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.payoutTitle} numberOfLines={1}>
                      {p.title}
                    </Text>
                    <View style={[styles.statePill, { backgroundColor: st.bg }]}>
                      <Text style={[styles.stateLabel, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.payoutDate}>{p.date}</Text>
                  <Text style={styles.payoutCalc}>{p.calc}</Text>
                </View>
                <Text style={styles.payoutAmount}>+{formatMoney(p.amount, currency)}</Text>
              </View>
            );
          })}
        </View>
        <View style={{ height: 130 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  payoutHighlight: {
    backgroundColor: '#FFFBEF',
    borderLeftWidth: 3,
    borderLeftColor: colors.yellow,
    paddingLeft: 15,
  },
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  balanceCard: { backgroundColor: colors.ink, borderRadius: 18, padding: 20, paddingHorizontal: 22 },
  balLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  balValue: { fontSize: 17, fontWeight: '800', letterSpacing: -0.4, marginTop: 4 },
  balDiv: { width: 1, backgroundColor: 'rgba(255,255,255,0.14)' },
  cashOutBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  cashOutLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  balNote: { fontSize: 11, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 10, lineHeight: 15 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  statLabel: { fontSize: 10.5, color: colors.greyWarm, fontWeight: '600' },
  statValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, marginTop: 3 },
  feeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    paddingHorizontal: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  feeStd: { fontSize: 14, textDecorationLine: 'line-through', color: '#B0AAA1', fontWeight: '600' },
  feePromo: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, color: '#159A57' },
  // Standard rate: same weight as the promo figure, neutral colour — the
  // green is the promo's signal and must not read as one when there is none.
  feeRate: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, color: colors.ink },
  feeUnknown: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, color: colors.greyLight },
  promoChip: { backgroundColor: '#E6F7EE', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  promoLabel: { fontSize: 10.5, fontWeight: '800', color: '#159A57', letterSpacing: 0.3 },
  feeNote: { fontSize: 11.5, color: colors.grey, marginTop: 10, lineHeight: 17 },
  sectionTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 26, marginBottom: 12 },
  list: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 15, paddingHorizontal: 18 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F4F1EA' },
  payoutAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EFEBE3' },
  payoutTitle: { fontSize: 12.5, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  statePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  stateLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  payoutDate: { fontSize: 10.5, color: colors.greyWarm, marginTop: 2 },
  payoutCalc: { fontSize: 11, color: '#9A948B', marginTop: 3 },
  payoutAmount: { fontSize: 14.5, fontWeight: '800', color: '#159A57' },
});
