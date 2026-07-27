import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, InfoBanner } from '../../../components/ui/Misc';
import { useAuth } from '../../../lib/store';
import { formatMoney } from '../../../lib/constants/business';
import { colors, spacing } from '../../../lib/theme';

export default function Wallet() {
  const currency = useAuth((s) => s.currency);
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Wallet</Text>
        <Card style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Snapt Credit</Text>
          <Text style={styles.balance}>{formatMoney(0, currency)}</Text>
          <Text style={styles.balanceNote}>
            Referral and credit rewards are coming soon.
          </Text>
        </Card>
        <View style={{ marginTop: 14 }}>
          {/* Snapt Credit is a visual placeholder only — out of MVP scope (§17) */}
          <InfoBanner text="Payment methods, receipts, and payout details land here once payments go live." />
        </View>
        <View style={{ height: 130 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 70 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, marginBottom: 18 },
  balanceCard: { alignItems: 'center', paddingVertical: 30, gap: 6 },
  balanceLabel: { fontSize: 12.5, fontWeight: '700', color: colors.grey },
  balance: { fontSize: 40, fontWeight: '800', letterSpacing: -1, color: colors.ink },
  balanceNote: { fontSize: 12, color: colors.greyLight },
});
