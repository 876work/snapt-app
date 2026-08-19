import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { EDIT_STYLES, REMOTE_PACKAGES, useUpload } from '../../lib/store/upload';
import { useAuth, useBookings } from '../../lib/store';
import { checkoutBooking } from '../../lib/payments';
import {
  CLIENT_SERVICE_FEE_RATE,
  formatMoney,
  formatMoneyTotal,
  USD_PROCESSING_NOTE,
} from '../../lib/constants/business';
import { colors, insetBottom } from '../../lib/theme';

const ADDONS = [
  // Labels are static copy; PRICES and the rush window render from the live
  // remote_addons / delivery_windows config (these values are offline
  // fallback only). The server charges from the same rows. The extra-files
  // add-on is gone: 15 files is a hard ceiling per order.
  { id: 'rush', title: 'Rush turnaround', sub: '', priceUsd: 20 },
  { id: 'revision', title: 'Extra revision round', sub: '1 free round included; per additional round', priceUsd: 15 },
];

export default function RemoteOrderSummary() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { files, mediaKind, styleId, tier, draftId, reset } = useUpload();
  const { setDraft, resetDraft, confirmDraft, addServerBooking } = useBookings();
  const [orderError, setOrderError] = React.useState<string | null>(null);

  const [addons, setAddons] = React.useState<string[]>([]);

  // Live prices with mirror fallback: package price, addon rates, fee rate,
  // and the rush/standard delivery hours all come from /v1/config, the same
  // rows the server charges from. (The FINAL charge is the server's own
  // number regardless — /v1/checkout/intent re-prices — this keeps what the
  // screen SHOWS in agreement with it.)
  const [cfg, setCfg] = React.useState<import('../../lib/api').PricingConfig | null>(null);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchPricingConfig }) => {
      if (!apiConfigured) return;
      fetchPricingConfig().then((c) => {
        if (c) setCfg(c);
      });
    });
  }, []);
  const mirrorPkg =
    REMOTE_PACKAGES[mediaKind].find((p) => p.tier === tier) ?? REMOTE_PACKAGES[mediaKind][0];
  const pkg = { ...mirrorPkg, priceUsd: cfg?.remoteTable?.[mediaKind]?.[mirrorPkg.tier] ?? mirrorPkg.priceUsd };
  const style = EDIT_STYLES.find((s) => s.id === styleId) ?? EDIT_STYLES[0];
  const addonPriceUsd = (id: string): number =>
    id === 'rush' ? cfg?.remoteAddons.rush ?? 20 : cfg?.remoteAddons.extra_revision ?? 15;
  const rushHours = cfg?.rushHours ?? 6;
  const standardHours = cfg?.standardHours ?? 24;
  const addonsTotal = ADDONS.filter((a) => addons.includes(a.id)).reduce((s, a) => s + addonPriceUsd(a.id), 0);
  const serviceFee = (pkg.priceUsd + addonsTotal) * (cfg?.clientServiceFeeRate ?? CLIENT_SERVICE_FEE_RATE);
  const total = pkg.priceUsd + addonsTotal + serviceFee;


  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState('');

  /**
   * PAYMENT WAITS FOR THE FOOTAGE, not the other way round.
   *
   * Files upload from the moment they are picked, so by the time anyone
   * reaches this screen they are usually done. When they are not, the client
   * still gets here, still reads the price, still picks add-ons — they are
   * only stopped at the last step, because a paid order the editor cannot
   * work from is worse than a wait.
   */
  const pending = files.filter(
    (f) => f.status === 'uploading' || f.status === 'queued' || f.status === 'finishing',
  ).length;
  // Bytes all sent, confirmation outstanding — the phase the button must
  // explain rather than sit silently disabled through.
  const finishing = files.filter((f) => f.status === 'finishing').length;
  const stillSending = pending - finishing;
  const failedCount = files.filter((f) => f.status === 'failed').length;
  const blocked = pending > 0 || failedCount > 0;

  const placeOrder = async () => {
    if (busy) return false; // re-entry guard
    if (blocked) return false;
    setBusy(true);
    setOrderError(null);
    try {
      return await runOrder();
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const runOrder = async () => {
    const { apiConfigured } = await import('../../lib/api');
    if (apiConfigured) {
      // Same payment-first contract as the in-person checkout: the order
      // does not exist until Stripe confirms.
      const outcome = await checkoutBooking(setStage, {
        type: 'remote',
        media_kind: mediaKind,
        remote_tier: pkg.tier,
        // The footage is already in the bucket under this draft. The webhook
        // claims it onto the booking it creates — server-side, because
        // Stripe retries that handler and the app might not survive the trip
        // back from the payment sheet.
        upload_draft_id: draftId,
        // The look the client chose. It was collected on the previous screen
        // and then dropped on the floor — the editor received an order with
        // no indication of how it should be graded.
        edit_style: styleId,
        addons: {
          rush: addons.includes('rush'),
          extra_revisions: addons.includes('revision') ? 1 : 0,
        },
      });

      if (outcome.ok) {
        // No upload here any more. The files landed while the client was
        // choosing, and checkout.ts claimed the draft onto the booking
        // inside the webhook — so there is nothing left to do but leave.
        reset();
        /**
         * Same landing as the in-person checkout — the remote-edit path
         * routed to the identical screen and so carried the identical bugs:
         * back fell through to Home, and a booking the local store had not
         * fetched yet rendered as "Booking not found" to someone who had
         * just paid. Bookings goes underneath; paid=1 marks the arrival.
         */
        router.dismissAll();
        router.replace('/(app)/bookings');
        if (outcome.bookingId) router.push(`/bookings/${outcome.bookingId}?paid=1`);
        return true;
      }
      if (outcome.reason === 'conflict') {
        setOrderError(outcome.conflict.error);
        return false;
      }
      if (outcome.reason === 'paid_unconfirmed') {
        setOrderError(
          'Your payment went through, but we haven\'t been able to confirm the order yet. ' +
            'Do NOT pay again — check Bookings in a minute, and contact support with reference ' +
            `${outcome.paymentIntentId.slice(-8)} if it doesn't appear.`,
        );
        return false;
      }
      setOrderError(
        outcome.reason === 'cancelled'
          ? 'Payment cancelled — nothing was charged and no order was placed.'
          : outcome.message ?? 'Payment failed — no charge was made. Please try again.',
      );
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
                    <Text style={styles.addonSub}>{a.id === 'rush' ? `Finished edit within ${rushHours} hours of upload — flat rate, any package` : a.sub}</Text>
                  </View>
                  <Text style={styles.addonPrice}>+{formatMoney(addonPriceUsd(a.id), currency)}</Text>
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
            {addons.includes('rush') ? `Delivered within ${rushHours} hours of upload` : `Delivered within ${standardHours} hours`} · 1 free
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
        {/* What is still in flight, pinned above the button — the client is
            waiting on THESE, and needs to see it is finite. */}
        {blocked && (
          <View style={styles.uploadPanel}>
            {files
              .filter((f) => f.status !== 'done')
              .map((f) => (
                <View key={f.id} style={styles.uploadRow}>
                  <Text style={styles.uploadName} numberOfLines={1}>
                    {f.name ?? 'file'}
                  </Text>
                  {f.status === 'failed' ? (
                    <Text style={styles.uploadFailed}>{f.error ?? 'failed'}</Text>
                  ) : f.status === 'finishing' ? (
                    <Text style={styles.uploadPct}>finishing…</Text>
                  ) : f.status === 'uploading' ? (
                    <Text style={styles.uploadPct}>{Math.min(99, Math.round((f.progress ?? 0) * 100))}%</Text>
                  ) : (
                    <Text style={styles.uploadPct}>waiting</Text>
                  )}
                </View>
              ))}
            <Text style={styles.uploadHint}>
              {failedCount > 0
                ? `${failedCount} ${failedCount === 1 ? 'file' : 'files'} didn't upload. Go back and retry ${failedCount === 1 ? 'it' : 'them'} — we won't take payment for an order your editor can't work from.`
                : stillSending > 0
                  ? `Still sending ${stillSending} ${stillSending === 1 ? 'file' : 'files'}. Payment opens the moment they're in.`
                  : // Everything is transferred; the server just hasn't
                    // confirmed the rows yet. Distinct copy, because "still
                    // sending" over a full bar reads as a hang.
                    `${finishing === 1 ? 'Your file is' : 'All files are'} uploaded — confirming with the server. Payment opens the moment ${finishing === 1 ? "it's" : "they're"} confirmed.`}
            </Text>
          </View>
        )}
        {orderError ? <Text style={styles.footerError}>{orderError}</Text> : null}
        {busy && !!stage && <Text style={styles.footerStage}>{stage}</Text>}
        <View style={styles.payBar}>
          <Text style={styles.payBarLabel}>You're paying (USD)</Text>
          <Text style={styles.payBarValue}>{formatMoney(total, 'USD')}</Text>
        </View>
        {/* Same contract as the in-person checkout: this opens the sheet,
            Stripe's Pay button confirms. */}
        <Button
          title={
            busy
              ? 'Working…'
              : finishing > 0 && stillSending === 0
                ? 'Confirming upload…'
                : pending > 0
                  ? `Waiting for ${pending} ${pending === 1 ? 'file' : 'files'}…`
                  : failedCount > 0
                  ? `${failedCount} ${failedCount === 1 ? 'file needs' : 'files need'} a retry`
                  : 'Continue to payment'
          }
          arrow={!blocked}
          loading={busy}
          disabled={blocked}
          onPress={placeOrder}
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
  footerStage: { fontSize: 12, color: colors.grey, textAlign: 'center', marginBottom: 10 },
  uploadPanel: { gap: 4, marginBottom: 10, maxHeight: 140 },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uploadName: { flex: 1, fontSize: 11.5, color: colors.grey },
  uploadPct: { fontSize: 11.5, fontWeight: '800', color: colors.ink },
  uploadHint: { fontSize: 11.5, color: colors.grey, lineHeight: 16.5, marginTop: 6 },
  uploadFailed: { fontSize: 11, fontWeight: '800', color: '#A32C2C', maxWidth: 160, textAlign: 'right' },
  payBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  payBarLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.62)' },
  payBarValue: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
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
