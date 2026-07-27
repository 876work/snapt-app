import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../components/ui/SlideToConfirm';
import { useAuth } from '../../lib/store';
import { formatMoney } from '../../lib/constants/business';
import { colors } from '../../lib/theme';

const METHODS = [
  { id: 'cibc', name: 'CIBC FirstCaribbean', sub: 'Bank account ··4321', eta: '1–2 business days' },
  { id: 'republic', name: 'Republic Bank', sub: 'Bank account ··8876', eta: '1–2 business days' },
  { id: 'paypal', name: 'PayPal', sub: 'jordan@snapt.example', eta: 'Within hours' },
];

export default function CashOut() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const [method, setMethod] = React.useState('cibc');
  const [done, setDone] = React.useState(false);
  const available = 128;
  const selected = METHODS.find((m) => m.id === method)!;

  if (done) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Cash out" />
        <View style={styles.doneWrap}>
          <View style={styles.doneIcon}>
            <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <Text style={styles.doneTitle}>{formatMoney(available, currency)} on its way</Text>
          <Text style={styles.doneSub}>
            Sent to {selected.name}. {selected.eta === 'Within hours' ? 'It should land within hours.' : `Expect it in ${selected.eta.toLowerCase()}.`}
          </Text>
          <Pressable onPress={() => router.back()} style={styles.doneBtn}>
            <Text style={styles.doneBtnLabel}>Back to Earnings</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Cash out" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>AVAILABLE TO CASH OUT</Text>
          <Text style={styles.amountValue}>{formatMoney(available, currency)}</Text>
          <Text style={styles.amountNote}>No cash-out fees. Pending funds aren't included.</Text>
        </View>

        <Text style={styles.sectionTitle}>Send to</Text>
        <View style={styles.list}>
          {METHODS.map((m, i) => {
            const active = m.id === method;
            return (
              <Pressable
                key={m.id}
                onPress={() => setMethod(m.id)}
                style={[styles.methodRow, i < METHODS.length - 1 && styles.rowBorder]}
              >
                <View style={[styles.radio, active && styles.radioActive]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.methodName}>{m.name}</Text>
                  <Text style={styles.methodSub}>{m.sub}</Text>
                </View>
                <Text style={styles.methodEta}>{m.eta}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <SlideToConfirm
          label={`Slide to cash out ${formatMoney(available, currency)}`}
          onConfirm={() => setDone(true)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  amountCard: { backgroundColor: colors.ink, borderRadius: 18, padding: 22, alignItems: 'center' },
  amountLabel: { fontSize: 9.5, fontWeight: '800', color: colors.yellow, letterSpacing: 0.6 },
  amountValue: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, color: '#fff', marginTop: 8 },
  amountNote: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 22, marginBottom: 12 },
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
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 15, paddingHorizontal: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F4F1EA' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D8D2C4' },
  radioActive: { borderWidth: 6, borderColor: colors.yellow },
  methodName: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  methodSub: { fontSize: 11, color: colors.greyWarm, marginTop: 2 },
  methodEta: { fontSize: 10, color: '#9A948B', fontWeight: '600' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, marginTop: -80 },
  doneIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  doneTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  doneSub: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  doneBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 28,
  },
  doneBtnLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
