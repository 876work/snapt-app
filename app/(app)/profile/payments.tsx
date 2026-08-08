import React from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../lib/text';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useAuth } from '../../../lib/store';
import { formatMoney, USD_PROCESSING_NOTE } from '../../../lib/constants/business';
import { colors, spacing, insetBottom } from '../../../lib/theme';
import { navShrinkOnScroll } from '../../../lib/navShrink';
import { KeyboardScrollView } from '../../../components/ui/KeyboardScrollView';

/**
 * Real charge/refund history — moved here from the old Wallet tab, same
 * fetch and same list, new home under Profile → Account. Starts EMPTY, never
 * with mock rows in API mode: showing invented transactions to someone
 * checking whether their refund arrived is worse than showing nothing.
 * Mock-mode fallback (local dev, no EXPO_PUBLIC_API_URL) is the only case
 * that renders illustrative rows, and it says so on-screen.
 */
const MOCK_TXNS = [
  { id: 't1', kind: 'edit', title: 'Photo edit package', date: 'Jul 22', method: 'Visa ·· 4412', amount: -102.6, tint: '#FFF4D6', stroke: '#B98600' },
  { id: 't2', kind: 'event', title: 'Portraits session', date: 'Jul 10', method: 'Visa ·· 4412', amount: -140.4, tint: '#EAF8F0', stroke: '#1B9A57' },
  { id: 't3', kind: 'credit', title: 'Refund — cancelled booking', date: 'Jun 28', method: 'To Visa ·· 4412', amount: 130, tint: '#EAFBFD', stroke: '#3FA9BC' },
  { id: 't4', kind: 'event', title: 'Family session', date: 'Jun 14', method: 'Mastercard ·· 8823', amount: -216, tint: '#EAF8F0', stroke: '#1B9A57' },
];

export default function PaymentsAndReceipts() {
  const { currency } = useAuth();
  const [txns, setTxns] = React.useState<typeof MOCK_TXNS>([]);
  const [txnsState, setTxnsState] = React.useState<'loading' | 'ready' | 'error' | 'mock'>('loading');

  const loadTxns = React.useCallback(async () => {
    const { apiConfigured } = await import('../../../lib/api');
    if (!apiConfigured) {
      setTxns(MOCK_TXNS);
      setTxnsState('mock');
      return;
    }
    const { supabase } = await import('../../../lib/supabase');
    if (!supabase) {
      setTxnsState('error');
      return;
    }
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;
    if (!token) {
      setTxnsState('error');
      return;
    }
    const res = await fetch(
      `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '')}/v1/wallet/transactions`,
      { headers: { Authorization: `Bearer ${token}` } },
    ).catch(() => null);
    if (!res?.ok) {
      setTxnsState('error');
      return;
    }
    const json = (await res.json()) as {
      transactions: { id: string; type: string; amount_usd: number; created_at: string }[];
    };
    setTxns(
      json.transactions.map((t) => ({
        id: t.id,
        kind: t.type === 'refund' ? 'credit' : 'event',
        title: t.type === 'refund' ? 'Refund — cancelled booking' : 'Booking payment',
        date: new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        method: t.type === 'refund' ? 'To your card' : 'Card on file',
        amount: t.type === 'refund' ? Number(t.amount_usd) : -Number(t.amount_usd),
        tint: t.type === 'refund' ? '#EAFBFD' : '#EAF8F0',
        stroke: t.type === 'refund' ? '#3FA9BC' : '#1B9A57',
      })),
    );
    setTxnsState('ready');
  }, []);

  // useFocusEffect, not a mount-once effect: a refund issued while the app is
  // open (book → cancel minutes later) should appear without a restart.
  useFocusEffect(
    React.useCallback(() => {
      loadTxns();
    }, [loadTxns]),
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title="Payments & receipts" />
      <KeyboardScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {txnsState === 'mock' && (
          <Text style={styles.mockNote}>Illustrative data — no server connected.</Text>
        )}
        {currency === 'XCD' && <Text style={styles.usdNote}>{USD_PROCESSING_NOTE}</Text>}
        <View style={styles.list}>
          {txnsState === 'loading' && txns.length === 0 && (
            <Text style={styles.txnNote}>Loading your transactions…</Text>
          )}
          {txnsState === 'error' && (
            <Text style={styles.txnNote}>
              Couldn't load your transactions just now. Pull back to this screen to retry.
            </Text>
          )}
          {(txnsState === 'ready' || txnsState === 'mock') && txns.length === 0 && (
            <Text style={styles.txnNote}>No payments yet. Charges and refunds appear here.</Text>
          )}
          {txns.map((t, i) => (
            <View key={t.id} style={[styles.row, i < txns.length - 1 && styles.rowBorder]}>
              <View style={[styles.txnIcon, { backgroundColor: t.tint }]}>
                {t.kind === 'edit' && (
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Rect x="3" y="6.5" width="18" height="13" rx="3" stroke={t.stroke} strokeWidth={1.8} />
                    <Path d="M8.5 6.5l1.2-2h4.6l1.2 2" stroke={t.stroke} strokeWidth={1.8} strokeLinejoin="round" />
                    <Circle cx="12" cy="13" r="3.3" stroke={t.stroke} strokeWidth={1.8} />
                  </Svg>
                )}
                {t.kind === 'event' && (
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={t.stroke} strokeWidth={1.8} />
                    <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={t.stroke} strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                )}
                {t.kind === 'credit' && (
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 19V5m0 0l-5 5m5-5l5 5" stroke={t.stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.methodLabel}>{t.title}</Text>
                <Text style={styles.methodSub}>
                  {t.date} · {t.method}
                </Text>
              </View>
              <Text style={[styles.txnAmount, { color: t.amount > 0 ? '#1B9A57' : colors.ink }]}>
                {t.amount > 0 ? '+' : '−'}
                {formatMoney(Math.abs(t.amount), 'USD')}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ height: 40 }} />
      </KeyboardScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 14, paddingBottom: insetBottom + 24 },
  mockNote: { fontSize: 11.5, color: colors.grey, marginBottom: 10 },
  usdNote: { fontSize: 11, color: colors.grey, lineHeight: 15.5, marginBottom: 10 },
  txnNote: { fontSize: 13, color: colors.grey, paddingVertical: 14, paddingHorizontal: 2, lineHeight: 19 },
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F4F1EA' },
  methodLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  methodSub: { fontSize: 9.5, color: colors.greyWarm, marginTop: 2 },
  txnIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txnAmount: { fontSize: 13, fontWeight: '800' },
});
