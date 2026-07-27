import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useAuth } from '../../../lib/store';
import { formatMoney } from '../../../lib/constants/business';
import { colors, spacing } from '../../../lib/theme';

interface CardMethod {
  id: string;
  brand: string;
  brandBg: string;
  label: string;
  sub: string;
  isDefault: boolean;
}

const TXNS = [
  { id: 't1', kind: 'edit', title: 'Photo edit package', date: 'Jul 22', method: 'Visa ·· 4412', amount: -102.6, tint: '#FFF4D6', stroke: '#B98600' },
  { id: 't2', kind: 'event', title: 'Portraits session', date: 'Jul 10', method: 'Visa ·· 4412', amount: -140.4, tint: '#EAF8F0', stroke: '#1B9A57' },
  { id: 't3', kind: 'credit', title: 'Refund — cancelled booking', date: 'Jun 28', method: 'To Visa ·· 4412', amount: 130, tint: '#EAFBFD', stroke: '#3FA9BC' },
  { id: 't4', kind: 'event', title: 'Family session', date: 'Jun 14', method: 'Mastercard ·· 8823', amount: -216, tint: '#EAF8F0', stroke: '#1B9A57' },
];

export default function Wallet() {
  const { currency, setCurrency } = useAuth();
  const [methods, setMethods] = React.useState<CardMethod[]>([
    { id: 'c1', brand: 'VISA', brandBg: '#1A3B8F', label: 'Visa ending 4412', sub: 'Expires 08/28', isDefault: true },
    { id: 'c2', brand: 'MC', brandBg: '#2B2B2B', label: 'Mastercard ending 8823', sub: 'Expires 03/27', isDefault: false },
  ]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [manageId, setManageId] = React.useState<string | null>(null);
  const [ncNumber, setNcNumber] = React.useState('');
  const [ncExp, setNcExp] = React.useState('');
  const [ncCvc, setNcCvc] = React.useState('');
  const [ncName, setNcName] = React.useState('');

  const manageCard = methods.find((m) => m.id === manageId);
  const recentSpend = TXNS.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);

  const addCard = () => {
    const last4 = ncNumber.replace(/\D/g, '').slice(-4) || '0000';
    setMethods((m) => [
      ...m,
      { id: `c${Date.now()}`, brand: 'CARD', brandBg: '#5C574E', label: `Card ending ${last4}`, sub: 'Added just now', isDefault: false },
    ]);
    setNcNumber('');
    setNcExp('');
    setNcCvc('');
    setNcName('');
    setAddOpen(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Wallet</Text>
        <Pressable onPress={() => setCurrency(currency === 'USD' ? 'XCD' : 'USD')} style={styles.currencyPill}>
          <Text style={styles.currencyLabel}>{currency}</Text>
          <Svg width={9} height={6} viewBox="0 0 9 6" fill="none">
            <Path d="M1 1l3.5 3.5L8 1" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Credit card */}
        <View style={styles.creditCard}>
          <View style={styles.creditGlow} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.creditLabel}>SNAPT CREDIT</Text>
              {/* Snapt Credit remains a visual placeholder — out of MVP scope (§17) */}
              <Text style={styles.creditValue}>{formatMoney(25, currency)}</Text>
              <Text style={styles.creditNote}>Applied automatically at checkout on your next booking.</Text>
            </View>
            <View style={styles.creditIcon}>
              <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <Path d="M3.5 8.5A2.5 2.5 0 016 6h11.5A2.5 2.5 0 0120 8.5v8a2.5 2.5 0 01-2.5 2.5H6a2.5 2.5 0 01-2.5-2.5v-8z" stroke={colors.yellow} strokeWidth={1.8} strokeLinejoin="round" />
                <Path d="M3.5 10.5h13a2 2 0 012 2v1a2 2 0 01-2 2h-13" stroke={colors.yellow} strokeWidth={1.8} />
                <Circle cx="16" cy="13" r="1.2" fill={colors.yellow} />
              </Svg>
            </View>
          </View>
        </View>

        {/* Stats strip */}
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>SAVED CARDS</Text>
            <Text style={styles.statValue}>{methods.length}</Text>
          </View>
          <View style={styles.statDiv} />
          <View style={styles.stat}>
            <Text style={styles.statLabel}>RECENT SPEND</Text>
            <Text style={styles.statValue}>{formatMoney(recentSpend, currency)}</Text>
          </View>
        </View>

        {/* Payment methods */}
        <Text style={styles.sectionTitle}>Payment methods</Text>
        <View style={styles.list}>
          {methods.map((m) => (
            <Pressable key={m.id} onPress={() => setManageId(m.id)} style={[styles.methodRow, styles.rowBorder]}>
              <View style={[styles.brandChip, { backgroundColor: m.brandBg }]}>
                <Text style={styles.brandLabel}>{m.brand}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.methodLabel}>{m.label}</Text>
                <Text style={styles.methodSub}>{m.sub}</Text>
              </View>
              {m.isDefault && (
                <View style={styles.defaultBadge}>
                  <Text style={styles.defaultLabel}>DEFAULT</Text>
                </View>
              )}
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
          ))}
          <Pressable onPress={() => setAddOpen(true)} style={styles.methodRow}>
            <View style={styles.addChip}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M12 5v14M5 12h14" stroke={colors.yellowDark} strokeWidth={2.2} strokeLinecap="round" />
              </Svg>
            </View>
            <Text style={styles.addLabel}>Add payment method</Text>
          </Pressable>
        </View>

        {/* Transactions */}
        <Text style={styles.sectionTitle}>Transactions</Text>
        <View style={styles.list}>
          {TXNS.map((t, i) => (
            <View key={t.id} style={[styles.methodRow, i < TXNS.length - 1 && styles.rowBorder]}>
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
                {formatMoney(Math.abs(t.amount), currency)}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ height: 130 }} />
      </ScrollView>

      {/* Add card sheet */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setAddOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Add payment method</Text>
              <Pressable onPress={() => setAddOpen(false)} style={styles.sheetClose}>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 5l14 14M19 5L5 19" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>
            <TextInput
              value={ncNumber}
              onChangeText={setNcNumber}
              placeholder="Card number"
              placeholderTextColor="#9A9A9A"
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: 11, marginTop: 11 }}>
              <TextInput
                value={ncExp}
                onChangeText={setNcExp}
                placeholder="MM/YY"
                placeholderTextColor="#9A9A9A"
                keyboardType="number-pad"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                value={ncCvc}
                onChangeText={setNcCvc}
                placeholder="CVC"
                placeholderTextColor="#9A9A9A"
                keyboardType="number-pad"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
            <TextInput
              value={ncName}
              onChangeText={setNcName}
              placeholder="Name on card"
              placeholderTextColor="#9A9A9A"
              style={[styles.input, { marginTop: 11 }]}
            />
            <View style={styles.stripeRow}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ marginTop: 1 }}>
                <Rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" stroke={colors.grey} strokeWidth={1.7} />
                <Path d="M8 10.5V8a4 4 0 018 0v2.5" stroke={colors.grey} strokeWidth={1.7} />
              </Svg>
              <Text style={styles.stripeText}>
                Securely stored with Stripe. Snapt never sees your full card number.
              </Text>
            </View>
            <Pressable onPress={addCard} style={styles.cta}>
              <Text style={styles.ctaLabel}>Add card</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Manage card sheet */}
      <Modal visible={!!manageCard} transparent animationType="slide" onRequestClose={() => setManageId(null)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setManageId(null)} />
          {manageCard && (
            <View style={styles.sheet}>
              <View style={styles.grabber} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 18 }}>
                <View style={[styles.brandChip, { width: 42, height: 30, backgroundColor: manageCard.brandBg }]}>
                  <Text style={styles.brandLabel}>{manageCard.brand}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: colors.ink }}>{manageCard.label}</Text>
                  <Text style={styles.methodSub}>{manageCard.sub}</Text>
                </View>
              </View>
              {manageCard.isDefault && (
                <View style={styles.defaultNote}>
                  <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 12.5l4 4L19 7" stroke={colors.yellowDark} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={styles.defaultNoteLabel}>This is your default card</Text>
                </View>
              )}
              <Pressable
                onPress={() => {
                  setMethods((ms) => ms.map((m) => ({ ...m, isDefault: m.id === manageCard.id })));
                  setManageId(null);
                }}
                style={styles.darkBtn}
              >
                <Text style={styles.darkBtnLabel}>Set as default</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setMethods((ms) => ms.filter((m) => m.id !== manageCard.id));
                  setManageId(null);
                }}
                style={styles.removeBtn}
              >
                <Text style={styles.removeBtnLabel}>Remove card</Text>
              </Pressable>
              <Pressable onPress={() => setManageId(null)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnLabel}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  header: {
    paddingTop: 66,
    paddingHorizontal: 22,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35, color: colors.ink },
  currencyPill: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: '#F1EEE7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  currencyLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 12 },
  creditCard: {
    backgroundColor: colors.ink,
    borderRadius: 20,
    padding: 18,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  creditGlow: {
    position: 'absolute',
    right: -26,
    top: -26,
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: 'rgba(255,184,0,0.10)',
  },
  creditLabel: { fontSize: 9.5, fontWeight: '800', color: colors.yellow, letterSpacing: 0.6 },
  creditValue: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: '#fff', marginTop: 6, lineHeight: 32 },
  creditNote: { fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 8, lineHeight: 14 },
  creditIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(255,184,0,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 4,
    marginTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  stat: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 8 },
  statDiv: { width: 1, backgroundColor: '#F0EDE6', marginVertical: 3 },
  statLabel: { fontSize: 9.5, fontWeight: '800', color: colors.yellowDark, letterSpacing: 0.6 },
  statValue: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  sectionTitle: { fontSize: 13, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 22, marginBottom: 10, marginHorizontal: 2 },
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
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F4F1EA' },
  brandChip: {
    width: 40,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLabel: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },
  methodLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  methodSub: { fontSize: 9.5, color: colors.greyWarm, marginTop: 2 },
  defaultBadge: {
    backgroundColor: '#FFF1CC',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  defaultLabel: { fontSize: 8.5, fontWeight: '800', color: '#8A6800', letterSpacing: 0.4 },
  addChip: {
    width: 40,
    height: 28,
    borderRadius: 7,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D9D4C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { flex: 1, fontSize: 12, fontWeight: '800', color: colors.yellowDark },
  txnIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txnAmount: { fontSize: 13, fontWeight: '800' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: 30,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8D8', alignSelf: 'center', marginBottom: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  sheetClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ECECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#E7E7E7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  stripeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 14, paddingHorizontal: 2 },
  stripeText: { flex: 1, fontSize: 10.5, color: colors.greyWarm, lineHeight: 15 },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  ctaLabel: { fontSize: 16, fontWeight: '800', color: colors.ink },
  defaultNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 14,
    padding: 13,
    paddingHorizontal: 15,
    marginBottom: 10,
  },
  defaultNoteLabel: { fontSize: 13, fontWeight: '700', color: '#8A6800' },
  darkBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  darkBtnLabel: { fontSize: 15, fontWeight: '800', color: '#fff' },
  removeBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#F1DADA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  removeBtnLabel: { fontSize: 15, fontWeight: '800', color: '#C0392B' },
  cancelBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
