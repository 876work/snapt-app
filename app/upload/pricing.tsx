import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../components/ui/SlideToConfirm';
import { EDIT_STYLES, REMOTE_PACKAGES, useUpload } from '../../lib/store/upload';
import { useAuth, useBookings } from '../../lib/store';
import { CLIENT_SERVICE_FEE_RATE, formatMoney } from '../../lib/constants/business';
import { colors } from '../../lib/theme';

const ADDONS = [
  { id: 'rush', title: 'Rush delivery', sub: 'Finished edit within 48 hours', priceUsd: 30 },
  { id: 'extra-files', title: 'Extra files', sub: '+10 files beyond the package limit', priceUsd: 20 },
  { id: 'revision', title: 'Extra revision round', sub: '1 free round included', priceUsd: 15 },
];

export default function RemoteOrderSummary() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { files, mediaKind, styleId, tier, reset } = useUpload();
  const { setDraft, resetDraft, confirmDraft, addServerBooking } = useBookings();
  const [orderError, setOrderError] = React.useState<string | null>(null);

  const [addons, setAddons] = React.useState<string[]>([]);
  const [payOpen, setPayOpen] = React.useState(false);
  const [cardName, setCardName] = React.useState('');
  const [cardNumber, setCardNumber] = React.useState('');
  const [cardExp, setCardExp] = React.useState('');
  const [cardCvc, setCardCvc] = React.useState('');
  const [saveCard, setSaveCard] = React.useState(true);

  const pkg =
    REMOTE_PACKAGES[mediaKind].find((p) => p.tier === tier) ?? REMOTE_PACKAGES[mediaKind][0];
  const style = EDIT_STYLES.find((s) => s.id === styleId) ?? EDIT_STYLES[0];
  const addonsTotal = ADDONS.filter((a) => addons.includes(a.id)).reduce((s, a) => s + a.priceUsd, 0);
  const serviceFee = (pkg.priceUsd + addonsTotal) * CLIENT_SERVICE_FEE_RATE;
  const total = pkg.priceUsd + addonsTotal + serviceFee;

  const cardValid =
    cardName.trim().length > 1 &&
    cardNumber.replace(/\D/g, '').length >= 15 &&
    /^\d{2}\s*\/?\s*\d{2}$/.test(cardExp.trim()) &&
    cardCvc.replace(/\D/g, '').length >= 3;

  const placeOrder = async () => {
    const { apiConfigured, createRemoteOrderApi } = await import('../../lib/api');
    if (apiConfigured) {
      // Server prices from remote_pricing_table (§8). Add-ons stay
      // client-side until the add-on catalog moves to config.
      const result = await createRemoteOrderApi(mediaKind, pkg.tier);
      if (result && 'booking' in result) {
        addServerBooking(result.booking);
        reset();
        setPayOpen(false);
        router.dismissAll();
        router.replace(`/bookings/${result.booking.id}`);
        return;
      }
      if (result && 'error' in result) {
        setOrderError(result.error);
        return;
      }
      // null = API unreachable — fall through to mock.
    }
    resetDraft('remote');
    setDraft({ type: 'remote', mediaKind });
    const booking = confirmDraft(pkg.priceUsd + addonsTotal);
    reset();
    setPayOpen(false);
    router.dismissAll();
    router.replace(`/bookings/${booking.id}`);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Order summary" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={styles.pkgName}>{pkg.name}</Text>
              <Text style={styles.pkgSub}>
                {style.name} style · {files.length} files
              </Text>
            </View>
            <Text style={styles.pkgPrice}>{formatMoney(pkg.priceUsd, currency)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Add-ons</Text>
        <View style={[styles.card, { paddingVertical: 0, paddingHorizontal: 0 }]}>
          {ADDONS.map((a, i) => {
            const on = addons.includes(a.id);
            return (
              <View key={a.id}>
                {i > 0 && <View style={styles.addonDiv} />}
                <View style={styles.addonRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addonTitle}>{a.title}</Text>
                    <Text style={styles.addonSub}>{a.sub}</Text>
                  </View>
                  <Text style={styles.addonPrice}>+{formatMoney(a.priceUsd, currency)}</Text>
                  <Pressable
                    onPress={() => setAddons((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}
                    style={[styles.switchTrack, on && styles.switchTrackOn]}
                  >
                    <View style={[styles.switchKnob, on && styles.switchKnobOn]} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.etaRow}>
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="9" stroke={colors.success} strokeWidth={1.9} />
            <Path d="M12 7.5V12l3 2" stroke={colors.success} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={styles.etaText}>
            {addons.includes('rush') ? 'Delivered within 48 hours' : 'Typical delivery in 5 days'} · 1 free
            revision included
          </Text>
        </View>

        <View style={[styles.card, { marginTop: 20, gap: 9 }]}>
          <Row label="Package" value={formatMoney(pkg.priceUsd, currency)} />
          <Row label="Add-ons" value={formatMoney(addonsTotal, currency)} />
          <Row label="Service fee" value={formatMoney(serviceFee, currency)} />
          <View style={styles.hr} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(total, currency)}</Text>
          </View>
        </View>

        <View style={styles.stripeRow}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ marginTop: 1 }}>
            <Rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" stroke={colors.grey} strokeWidth={1.8} />
            <Path d="M7.5 10.5V8a4.5 4.5 0 019 0v2.5" stroke={colors.grey} strokeWidth={1.8} />
          </Svg>
          <Text style={styles.stripeText}>
            Payments are securely processed by Stripe. Snapt never stores your card details.
          </Text>
        </View>
        <Text style={styles.terms}>
          By continuing, you agree to our <Text style={styles.link}>Terms & Conditions</Text> and{' '}
          <Text style={styles.link}>Privacy Policy</Text>.
        </Text>
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={() => setPayOpen(true)} style={styles.cta}>
          <Text style={styles.ctaLabel}>Continue to Payment</Text>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>

      <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPayOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Payment</Text>
              <Pressable onPress={() => setPayOpen(false)} style={styles.sheetClose}>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 5l14 14M19 5L5 19" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.card, { paddingVertical: 0, paddingHorizontal: 0 }]}>
                <View style={styles.fieldRow}>
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                    <Circle cx="12" cy="8.5" r="3.6" stroke={colors.grey} strokeWidth={1.8} />
                    <Path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                  <TextInput
                    value={cardName}
                    onChangeText={setCardName}
                    placeholder="Cardholder name"
                    placeholderTextColor="#9A9A9A"
                    style={styles.input}
                  />
                </View>
                <View style={styles.fieldDiv} />
                <View style={styles.fieldRow}>
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                    <Rect x="3" y="6" width="18" height="12.5" rx="3" stroke={colors.grey} strokeWidth={1.8} />
                    <Path d="M3 10h18" stroke={colors.grey} strokeWidth={1.8} />
                  </Svg>
                  <TextInput
                    value={cardNumber}
                    onChangeText={setCardNumber}
                    placeholder="Card number"
                    placeholderTextColor="#9A9A9A"
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </View>
                <View style={styles.fieldDiv} />
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 50, paddingRight: 16 }}>
                    <TextInput
                      value={cardExp}
                      onChangeText={setCardExp}
                      placeholder="MM / YY"
                      placeholderTextColor="#9A9A9A"
                      keyboardType="number-pad"
                      style={styles.input}
                    />
                  </View>
                  <View style={{ width: 1, backgroundColor: '#F1F1F1' }} />
                  <View style={{ width: 110, paddingVertical: 14, paddingHorizontal: 16 }}>
                    <TextInput
                      value={cardCvc}
                      onChangeText={setCardCvc}
                      placeholder="CVC"
                      placeholderTextColor="#9A9A9A"
                      keyboardType="number-pad"
                      style={styles.input}
                    />
                  </View>
                </View>
              </View>
              <Pressable onPress={() => setSaveCard(!saveCard)} style={styles.saveRow}>
                <View style={[styles.checkbox, saveCard && styles.checkboxOn]}>
                  {saveCard && (
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12.5l4 4L19 7" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
                <Text style={styles.saveLabel}>Save this card for next time</Text>
              </Pressable>
              <View style={styles.payingBar}>
                <Text style={styles.payingLabel}>You're paying</Text>
                <Text style={styles.payingValue}>{formatMoney(total, currency)}</Text>
              </View>
              {cardValid ? (
                <>
                  {orderError ? (
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.error, marginBottom: 10 }}>
                      {orderError}
                    </Text>
                  ) : null}
                  <SlideToConfirm label="Slide to pay & order" onConfirm={placeOrder} />
                </>
              ) : (
                <View style={styles.payDisabled}>
                  <Text style={styles.payDisabledLabel}>Enter card details to pay</Text>
                </View>
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowLabel}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pkgName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  pkgSub: { fontSize: 12.5, color: colors.grey, marginTop: 2 },
  pkgPrice: { fontSize: 15, fontWeight: '800', color: colors.ink },
  sectionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 22, marginBottom: 12 },
  addonRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, paddingHorizontal: 18 },
  addonDiv: { height: 1, backgroundColor: '#F1F1F1', marginLeft: 18 },
  addonTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  addonSub: { fontSize: 12, color: colors.grey, marginTop: 2 },
  addonPrice: { fontSize: 13, fontWeight: '700', color: colors.grey },
  switchTrack: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E8E4DB',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.yellow },
  switchKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  switchKnobOn: { alignSelf: 'flex-end' },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16, marginHorizontal: 4 },
  etaText: { flex: 1, fontSize: 12.5, color: colors.grey, lineHeight: 17 },
  hr: { height: 1, backgroundColor: '#F1F1F1', marginVertical: 3 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  totalLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
  totalValue: { fontSize: 20, fontWeight: '800', color: colors.ink },
  rowLabel: { fontSize: 13.5, color: colors.grey },
  stripeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, paddingHorizontal: 2 },
  stripeText: { flex: 1, fontSize: 12, color: colors.grey, lineHeight: 17 },
  terms: { fontSize: 11.5, color: '#9A9A9A', lineHeight: 17, marginTop: 12, paddingHorizontal: 2 },
  link: { color: colors.yellowDark, fontWeight: '600', textDecorationLine: 'underline' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: 30,
    maxHeight: '90%',
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8D8', alignSelf: 'center', marginBottom: 10 },
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
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  fieldDiv: { height: 1, backgroundColor: '#F1F1F1', marginLeft: 52 },
  input: { flex: 1, fontSize: 14, color: colors.ink, padding: 0 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingHorizontal: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#D8D2C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  saveLabel: { fontSize: 11.5, fontWeight: '700', color: colors.ink },
  payingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 12,
  },
  payingLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.62)' },
  payingValue: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  payDisabled: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#EFEDE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  payDisabledLabel: { fontSize: 13.5, fontWeight: '700', color: '#A8A29A' },
});
