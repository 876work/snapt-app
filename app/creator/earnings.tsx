import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useAuth } from '../../lib/store';
import {
  CREATOR_PLATFORM_FEE_RATE,
  CREATOR_PROMO_FEE_RATE,
  formatMoney,
} from '../../lib/constants/business';
import { colors } from '../../lib/theme';

const PAYOUTS = [
  { id: 'p1', title: 'Portraits — Keisha B.', state: 'pending', date: 'Jul 25 · clears in ~48h', calc: 'Job $140 − 20% promo fee', amount: 112 },
  { id: 'p2', title: 'Wedding edit — Andre P.', state: 'available', date: 'Jul 22', calc: 'Job $160 − 20% promo fee', amount: 128 },
  { id: 'p3', title: 'Family — Simone V.', state: 'paid', date: 'Jul 15 · to CIBC ··4321', calc: 'Job $216 − 20% promo fee', amount: 172.8 },
  { id: 'p4', title: 'Events — St. Lucia Jazz', state: 'paid', date: 'Jul 8 · to CIBC ··4321', calc: 'Job $320 − 20% promo fee', amount: 256 },
];

const STATE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: '#FFF4D6', color: '#8A6800', label: 'PENDING' },
  available: { bg: '#E6F7EE', color: '#159A57', label: 'AVAILABLE' },
  paid: { bg: '#F1EEE7', color: '#8A8377', label: 'PAID' },
};

export default function CreatorEarnings() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);

  // Real payout states in API mode (held → Pending, available, paid_out);
  // mock rows otherwise. Held funds flip to available server-side once the
  // 7-day hold elapses.
  const [real, setReal] = React.useState<{
    rows: typeof PAYOUTS;
    totals: { pending: number; available: number; paid_out: number };
  } | null>(null);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchEarnings }) => {
      if (!apiConfigured) return;
      fetchEarnings().then((data) => {
        if (!data) return;
        setReal({
          totals: data.totals,
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

  const rows = real?.rows ?? PAYOUTS;
  const pending = real?.totals.pending ?? 112;
  const available = real?.totals.available ?? 128;
  const paidOut = real?.totals.paid_out ?? 428.8;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Earnings" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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

        {/* Platform fee — promo shown with strikethrough per §5 */}
        <View style={styles.feeCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ minWidth: 0 }}>
              <Text style={styles.statLabel}>Your platform fee</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <Text style={styles.feeStd}>{(CREATOR_PLATFORM_FEE_RATE * 100).toFixed(0)}%</Text>
                <Text style={styles.feePromo}>{(CREATOR_PROMO_FEE_RATE * 100).toFixed(0)}%</Text>
              </View>
            </View>
            <View style={styles.promoChip}>
              <Text style={styles.promoLabel}>Limited-time rate</Text>
            </View>
          </View>
          <Text style={styles.feeNote}>
            You're keeping more of every job while this promo rate is active — normally{' '}
            {(CREATOR_PLATFORM_FEE_RATE * 100).toFixed(0)}%.
          </Text>
        </View>

        {/* Recent payouts */}
        <Text style={styles.sectionTitle}>Recent payouts</Text>
        <View style={styles.list}>
          {rows.map((p, i) => {
            const st = STATE_STYLE[p.state];
            return (
              <View key={p.id} style={[styles.payoutRow, i < rows.length - 1 && styles.rowBorder]}>
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
