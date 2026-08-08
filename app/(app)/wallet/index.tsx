import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../../lib/text';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, spacing, insetTop, insetBottom } from '../../../lib/theme';
import { navShrinkOnScroll } from '../../../lib/navShrink';

interface CardMethod {
  id: string;
  brand: string;
  brandBg: string;
  label: string;
  sub: string;
  isDefault: boolean;
}

export default function Wallet() {
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
        <Text style={styles.title}>Payment methods</Text>
      </View>
      <KeyboardScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Stats strip */}
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>SAVED CARDS</Text>
            <Text style={styles.statValue}>{methods.length}</Text>
          </View>
        </View>

        {/* Payment methods */}
        <Text style={styles.sectionTitle}>Cards on file</Text>
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

        <View style={{ height: 130 }} />
      </KeyboardScrollView>

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
    paddingTop: insetTop + 19,
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35, color: colors.ink },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 12 },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  stat: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 8 },
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
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: Math.max(insetBottom + 12, 30),
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
