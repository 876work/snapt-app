import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Misc';
import { SlideToConfirm } from '../../components/ui/SlideToConfirm';
import { DURATIONS } from '../../lib/mock/data';
import { creatorById, useAuth, useBookings } from '../../lib/store';
import {
  CANCEL_FULL_REFUND_HOURS,
  CLIENT_SERVICE_FEE_RATE,
  formatMoney,
} from '../../lib/constants/business';
import { colors, spacing } from '../../lib/theme';

interface Addon {
  id: string;
  title: string;
  sub: string;
  priceUsd: number;
}

// Add-on set mirrors the prototype's order summary; prices in USD.
const ADDONS: Addon[] = [
  { id: 'rush', title: 'Rush delivery', sub: 'Edited content within 48 hours', priceUsd: 25 },
  { id: 'extra-photos', title: 'Extra edited photos', sub: '+10 additional retouched shots', priceUsd: 18 },
  { id: 'revision', title: 'Extra revision round', sub: '1 free round included', priceUsd: 15 },
];

export default function OrderSummary() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { draft, confirmDraft } = useBookings();
  const creator = creatorById(draft.creatorId);
  const duration = DURATIONS.find((d) => d.hours === draft.durationHours);

  const [addons, setAddons] = React.useState<string[]>([]);
  const [payOpen, setPayOpen] = React.useState(false);
  const [cardName, setCardName] = React.useState('');
  const [cardNumber, setCardNumber] = React.useState('');
  const [cardExp, setCardExp] = React.useState('');
  const [cardCvc, setCardCvc] = React.useState('');
  const [saveCard, setSaveCard] = React.useState(true);

  const base = duration?.priceUsd ?? 0;
  const addonsTotal = ADDONS.filter((a) => addons.includes(a.id)).reduce((s, a) => s + a.priceUsd, 0);
  const serviceFee = (base + addonsTotal) * CLIENT_SERVICE_FEE_RATE;
  const total = base + addonsTotal + serviceFee;

  const cardValid =
    cardName.trim().length > 1 &&
    cardNumber.replace(/\D/g, '').length >= 15 &&
    /^\d{2}\s*\/?\s*\d{2}$/.test(cardExp.trim()) &&
    cardCvc.replace(/\D/g, '').length >= 3;

  const when =
    draft.date && draft.time
      ? new Date(`${draft.date}T${draft.time}:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }) + ` · ${draft.time}`
      : '—';

  const pkgLabel =
    draft.mediaKind === 'both' ? 'Photos + video' : draft.mediaKind === 'photo' ? 'Photos' : 'Video';

  const book = () => {
    const booking = confirmDraft(base + addonsTotal);
    setPayOpen(false);
    router.dismissAll();
    router.replace(`/bookings/${booking.id}`);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Order summary" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Booking card */}
        <View style={styles.card}>
          {creator && (
            <View style={styles.creatorRow}>
              <View style={styles.creatorPhoto}>
                <Image source={creator.photo} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.creatorTitle}>
                  {creator.name} · {pkgLabel}
                </Text>
                <Text style={styles.creatorSub}>
                  {draft.occasion ?? '—'} · {duration?.label ?? '—'}
                </Text>
              </View>
              <View style={styles.msgChip}>
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 6h14a1 1 0 011 1v8a1 1 0 01-1 1H9l-4 3.5V7a1 1 0 011-1z" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinejoin="round" />
                </Svg>
                <Text style={styles.msgLabel}>Message</Text>
              </View>
            </View>
          )}
          <View style={styles.etaNote}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Circle cx="12" cy="12" r="9" stroke="#8A7530" strokeWidth={1.8} />
              <Path d="M12 7.5V12l3 2" stroke="#8A7530" strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
            <Text style={styles.etaText}>Edited content is typically delivered within 5 days.</Text>
          </View>
          <Divider />
          <SummaryRow label="When" value={when} onEdit={() => router.push('/booking/occasion')} />
          <SummaryRow
            label="Where"
            value={draft.meetingPoint ? `${draft.meetingPoint}, ${draft.area ?? ''}` : (draft.area ?? '—')}
            onEdit={() => router.push('/booking/location')}
          />
          <SummaryRow label="Session" value={formatMoney(base, currency)} />
        </View>

        {/* Add-ons */}
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
                    onPress={() =>
                      setAddons((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))
                    }
                    style={[styles.switchTrack, on && styles.switchTrackOn]}
                  >
                    <View style={[styles.switchKnob, on && styles.switchKnobOn]} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {/* Price breakdown */}
        <View style={[styles.card, { marginTop: 20, gap: 9 }]}>
          <PriceRow label="Session" value={formatMoney(base, currency)} />
          <PriceRow label="Add-ons" value={formatMoney(addonsTotal, currency)} />
          <PriceRow label="Service fee" value={formatMoney(serviceFee, currency)} />
          <Divider />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(total, currency)}</Text>
          </View>
        </View>

        {/* Cancellation banner */}
        <View style={styles.cancelBanner}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.yellowDark} strokeWidth={1.8} />
            <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
          <Text style={styles.cancelText}>
            Free cancellation up to {CANCEL_FULL_REFUND_HOURS} hours before your session.
          </Text>
        </View>

        {/* Stripe + terms */}
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
        <Button title="Continue to Payment" arrow onPress={() => setPayOpen(true)} style={{ flex: 1 }} />
      </View>

      {/* Payment sheet */}
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
              <Text style={styles.savedLabel}>Saved cards</Text>
              <View style={styles.noCards}>
                <View style={styles.cardArt}>
                  <View style={styles.cardChip} />
                </View>
                <Text style={styles.noCardsTitle}>No cards saved yet</Text>
                <Text style={styles.noCardsSub}>
                  Add one below and checkout will be a single tap next time.
                </Text>
              </View>
              <Text style={styles.addCardTitle}>Add new card</Text>
              <View style={[styles.card, { paddingVertical: 0, paddingHorizontal: 0 }]}>
                <FieldRow
                  icon={
                    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                      <Circle cx="12" cy="8.5" r="3.6" stroke={colors.grey} strokeWidth={1.8} />
                      <Path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
                    </Svg>
                  }
                >
                  <TextInput
                    value={cardName}
                    onChangeText={setCardName}
                    placeholder="Cardholder name"
                    placeholderTextColor="#9A9A9A"
                    style={styles.input}
                  />
                </FieldRow>
                <View style={styles.fieldDiv} />
                <FieldRow
                  icon={
                    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                      <Rect x="3" y="6" width="18" height="12.5" rx="3" stroke={colors.grey} strokeWidth={1.8} />
                      <Path d="M3 10h18" stroke={colors.grey} strokeWidth={1.8} />
                    </Svg>
                  }
                >
                  <TextInput
                    value={cardNumber}
                    onChangeText={setCardNumber}
                    placeholder="Card number"
                    placeholderTextColor="#9A9A9A"
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </FieldRow>
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
                <SlideToConfirm label="Slide to pay & book" onConfirm={book} />
              ) : (
                <View style={{ height: 56, borderRadius: 16, backgroundColor: '#EFEDE7', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#A8A29A' }}>Enter card details to pay</Text>
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

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 }}>
        <Text style={styles.sumValue}>{value}</Text>
        {onEdit && (
          <Pressable onPress={onEdit}>
            <Text style={styles.editLink}>Edit</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.priceLabel}>{label}</Text>
      <Text style={styles.priceValue}>{value}</Text>
    </View>
  );
}

function FieldRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.fieldRow}>
      {icon}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  creatorPhoto: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  creatorTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  creatorSub: { fontSize: 12.5, color: colors.grey, marginTop: 2 },
  msgChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  msgLabel: { fontSize: 10, fontWeight: '800', color: colors.yellowDark },
  etaNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.segBgAlt,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  etaText: { flex: 1, fontSize: 10.5, fontWeight: '700', color: '#8A7530' },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sumLabel: { fontSize: 13, color: colors.grey },
  sumValue: { fontSize: 13, fontWeight: '700', color: colors.ink, textAlign: 'right', flexShrink: 1 },
  editLink: { fontSize: 10, fontWeight: '800', color: colors.yellowDark },
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
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  totalLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
  totalValue: { fontSize: 20, fontWeight: '800', color: colors.ink },
  priceLabel: { fontSize: 13.5, color: colors.grey },
  priceValue: { fontSize: 13.5, color: colors.grey },
  cancelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 14,
    padding: 12,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  cancelText: { flex: 1, fontSize: 10.5, color: '#8A6800', lineHeight: 15, fontWeight: '700' },
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
    flexDirection: 'row',
  },
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
  savedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  noCards: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardArt: {
    width: 56,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.yellow,
    marginBottom: 12,
  },
  cardChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 12,
    height: 9,
    borderRadius: 2,
    backgroundColor: 'rgba(26,26,26,0.25)',
  },
  noCardsTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  noCardsSub: { fontSize: 12.5, color: colors.grey, marginTop: 3, lineHeight: 17, textAlign: 'center' },
  addCardTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 20, marginBottom: 12 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  fieldDiv: { height: 1, backgroundColor: '#F1F1F1', marginLeft: 52 },
  input: { fontSize: 14, color: colors.ink, padding: 0 },
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
});
