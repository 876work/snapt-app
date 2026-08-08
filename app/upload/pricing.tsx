import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../components/ui/SlideToConfirm';
import { EDIT_STYLES, REMOTE_PACKAGES, useUpload } from '../../lib/store/upload';
import { useAuth, useBookings } from '../../lib/store';
import { abandonBooking, payForBooking, waitForCharge } from '../../lib/payments';
import {
  CLIENT_SERVICE_FEE_RATE,
  formatMoney,
  formatMoneyTotal,
  USD_PROCESSING_NOTE,
} from '../../lib/constants/business';
import { colors, insetBottom } from '../../lib/theme';

const ADDONS = [
  // Confirmed flat rates (Don, 2026-07-27), mirrored in the remote_addons
  // config row — the server charges from config, these only render. The
  // extra-files add-on is gone: 15 files is a hard ceiling per order.
  { id: 'rush', title: 'Rush turnaround', sub: 'Finished edit within 48 hours — flat rate, any package', priceUsd: 20 },
  { id: 'revision', title: 'Extra revision round', sub: '1 free round included; per additional round', priceUsd: 15 },
];

export default function RemoteOrderSummary() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { files, mediaKind, styleId, tier, reset } = useUpload();
  const { setDraft, resetDraft, confirmDraft, addServerBooking } = useBookings();
  const [orderError, setOrderError] = React.useState<string | null>(null);

  const [addons, setAddons] = React.useState<string[]>([]);

  const pkg =
    REMOTE_PACKAGES[mediaKind].find((p) => p.tier === tier) ?? REMOTE_PACKAGES[mediaKind][0];
  const style = EDIT_STYLES.find((s) => s.id === styleId) ?? EDIT_STYLES[0];
  const addonsTotal = ADDONS.filter((a) => addons.includes(a.id)).reduce((s, a) => s + a.priceUsd, 0);
  const serviceFee = (pkg.priceUsd + addonsTotal) * CLIENT_SERVICE_FEE_RATE;
  const total = pkg.priceUsd + addonsTotal + serviceFee;


  const placeOrder = async () => {
    const { apiConfigured, createRemoteOrderApi } = await import('../../lib/api');
    if (apiConfigured) {
      // Server prices from remote_pricing_table (§8). Add-ons stay
      // client-side until the add-on catalog moves to config.
      const result = await createRemoteOrderApi(mediaKind, pkg.tier, {
        rush: addons.includes('rush'),
        extraRevisions: addons.includes('revision') ? 1 : 0,
      });
      if (result && 'booking' in result) {
        // Unpaid until Stripe's webhook confirms. Sheet handles card + 3DS.
        const outcome = await payForBooking(result.booking.id);
        if (!outcome.ok) {
          // NEVER claim "nothing was charged" without checking. A 3DS
          // challenge can succeed while the sheet reports cancelled (e.g.
          // the user closes the browser themselves) — money moved, and the
          // webhook is the authority. Ask the server before deciding.
          const alreadyPaid = await waitForCharge(result.booking.id, 6000);
          if (alreadyPaid) {
            addServerBooking(result.booking);
            reset();
            router.dismissAll();
            router.replace(`/bookings/${result.booking.id}`);
            return true;
          }
          await abandonBooking(result.booking.id);
          setOrderError(
            outcome.reason === 'cancelled'
              ? 'Payment cancelled — nothing was charged.'
              : outcome.message ?? 'Payment failed — no charge was made. Please try again.',
          );
          return false; // slider unlocks for a retry
        }
        await waitForCharge(result.booking.id);
        // Upload the picked source files as raw footage (creator/editor-side
        // only — clients can never read raw back).
        for (const f of files) {
          if (f.uri) {
            await (await import('../../lib/api')).uploadMediaApi(result.booking.id, 'raw', {
              uri: f.uri,
              name: f.name ?? 'upload.jpg',
              mimeType: f.mimeType,
            });
          }
        }
        addServerBooking(result.booking);
        reset();
        router.dismissAll();
        router.replace(`/bookings/${result.booking.id}`);
        return true;
      }
      if (result && 'error' in result) {
        setOrderError(result.error);
        return false; // slider unlocks so the user can retry
      }
      // null = API unreachable. An error in API mode — the old mock
      // fallthrough invented a local order no editor would ever see.
      setOrderError("Couldn't reach the server — check your connection and slide again.");
      return false;
    }
    resetDraft('remote');
    setDraft({ type: 'remote', mediaKind });
    const booking = confirmDraft(pkg.priceUsd + addonsTotal);
    reset();
    router.dismissAll();
    router.replace(`/bookings/${booking.id}`);
    return true;
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Order summary" />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
            {/* Total = sum of the converted lines above (rounding absorbed). */}
            <Text style={styles.totalValue}>
              {formatMoneyTotal([pkg.priceUsd, addonsTotal, serviceFee], currency)}
            </Text>
          </View>
          {currency === 'XCD' && (
            <Text style={styles.usdChargeNote}>
              You'll be charged {formatMoney(total, 'USD')} USD — XCD figures are approximate.
            </Text>
          )}
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
          By continuing, you agree to our{' '}
          <Text style={styles.link} onPress={() => router.push('/legal/terms')}>
            Terms & Conditions
          </Text>{' '}
          and{' '}
          <Text style={styles.link} onPress={() => router.push('/legal/privacy')}>
            Privacy Policy
          </Text>
          .
        </Text>

        <Text style={styles.usdNote}>
          {currency === 'XCD' ? `≈ ${formatMoney(total, 'XCD')} · ` : ''}
          {USD_PROCESSING_NOTE}
        </Text>
        <View style={{ height: 24 }} />
      </KeyboardScrollView>

      <View style={styles.footer}>
        {orderError ? <Text style={styles.footerError}>{orderError}</Text> : null}
        {/* Same one-slide checkout as the in-person flow. */}
        <SlideToConfirm
          label="Slide to confirm & pay"
          value={formatMoney(total, 'USD')}
          valueLabel="You're paying (USD)"
          onConfirm={placeOrder}
        />
      </View>
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
  payError: { fontSize: 13, fontWeight: '600', color: colors.error, marginTop: 12 },
  securedRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginBottom: 18, paddingHorizontal: 2 },
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
  usdChargeNote: { fontSize: 11, color: colors.grey, fontWeight: '600', marginTop: 2 },
  usdNote: { fontSize: 11, color: colors.grey, lineHeight: 15.5, marginTop: 10, textAlign: 'center' },
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
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  footerError: { fontSize: 12.5, fontWeight: '700', color: '#A32C2C', textAlign: 'center', marginBottom: 10 },
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
    paddingBottom: Math.max(insetBottom + 12, 30),
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
});
