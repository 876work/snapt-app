import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Misc';
import { DURATIONS, packagePrice } from '../../lib/mock/data';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { creatorById, useAuth, useBookings } from '../../lib/store';
import { apiConfigured, fetchDaySlotsDetailed, isServerCreatorId, SlotConflict } from '../../lib/api';
import { SlotRecoverySheet } from '../../components/booking/SlotRecoverySheet';
import { checkoutBooking } from '../../lib/payments';
import {
  CANCEL_FULL_REFUND_HOURS,
  CLIENT_SERVICE_FEE_RATE,
  formatMoney,
  formatMoneyTotal,
  USD_PROCESSING_NOTE,
} from '../../lib/constants/business';
import { colors, spacing, insetBottom } from '../../lib/theme';

interface Addon {
  id: string;
  title: string;
  sub: string;
  priceUsd: number;
}

// CONFIRMED in-person add-ons (Don, 2026-07-28), mirrored in the
// in_person_addons config row — the server charges from config, these only
// render. extra revision matches the remote rate by design.
const ADDONS: Addon[] = [
  { id: 'rush', title: 'Rush delivery', sub: 'Edited content within 6 hours of your session', priceUsd: 25 },
  { id: 'extra-photos', title: 'Extra edited photos', sub: '+10 additional retouched shots', priceUsd: 18 },
  { id: 'revision', title: 'Extra revision round', sub: '1 free round included; per additional round', priceUsd: 15 },
];

export default function OrderSummary() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { draft, confirmDraft } = useBookings();
  const creator = creatorById(draft.creatorId);
  const duration = DURATIONS.find((d) => d.hours === draft.durationHours);

  const [addons, setAddons] = React.useState<string[]>([]);
  // Social prices extra photos PER-UNIT at selection time (after the shoot),
  // so the flat +10 pack would double-sell the same thing. The server
  // ignores the flag for Social regardless — this just keeps the UI honest.
  const visibleAddons = draft.social ? ADDONS.filter((a) => a.id !== 'extra-photos') : ADDONS;
  const [bookError, setBookError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<SlotConflict | null>(null);
  // In-flight guard. Without it a cold Render dyno (30-60s) leaves the
  // screen inert, and a second tap creates a second PaymentIntent.
  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState('');
  const [timeNote, setTimeNote] = React.useState<string | null>(null);

  // PRE-VALIDATE the slot on arrival: most conflicts should surface here,
  // before anyone slides toward a payment, not after.
  React.useEffect(() => {
    if (!apiConfigured || !draft.occasion || !draft.date || !draft.time || draft.durationHours == null) return;
    let cancelled = false;
    fetchDaySlotsDetailed(draft.occasion, draft.date, draft.durationHours, draft.area).then((slots) => {
      if (cancelled || !slots) return; // unreachable server: the book() 409 path still catches it
      const wantedCreator = isServerCreatorId(draft.creatorId) ? draft.creatorId : null;
      const slot = slots.find((x) => x.time === draft.time);
      const ok = slot && (!wantedCreator || slot.creator_ids.includes(wantedCreator));
      if (ok) return;
      const times = slots
        .filter((x) => (wantedCreator ? x.creator_ids.includes(wantedCreator) : x.creator_ids.length > 0))
        .map((x) => x.time)
        .slice(0, 8);
      setConflict({
        code: slot ? 'creator_taken' : 'slot_taken',
        error: 'That time is no longer available',
        alternative_times: times,
        rematch_available: !!slot && slot.creator_ids.length > 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [draft.occasion, draft.date, draft.time, draft.durationHours, draft.area, draft.creatorId]);

  // Display price from the confirmed table (service type × duration); the
  // server recomputes from config at booking creation (§8).
  const base = draft.durationHours != null
    ? draft.social?.price_usd ?? packagePrice(draft.mediaKind, draft.durationHours) ?? 0
    : 0;
  const addonsTotal = ADDONS.filter((a) => addons.includes(a.id)).reduce((s, a) => s + a.priceUsd, 0);
  const serviceFee = (base + addonsTotal) * CLIENT_SERVICE_FEE_RATE;
  const total = base + addonsTotal + serviceFee;


  const setDraftTime = (time: string) => {
    useBookings.getState().setDraft({ time });
    setTimeNote(`Time updated to ${time} — slide below to confirm.`);
  };

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

  const book = async () => {
    if (busy) return false; // re-entry guard
    setBusy(true);
    setBookError(null);
    try {
      return await runCheckout();
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const runCheckout = async () => {
    if (apiConfigured) {
      const draftNow = useBookings.getState().draft;
      // ONE call: prices server-side and opens the sheet. NOTHING is
      // created — no booking, no creator assignment, no offer clock, no
      // push — until Stripe confirms the payment via webhook.
      const outcome = await checkoutBooking(setStage, {
        type: draftNow.type === 'in-person' ? 'in_person' : 'remote',
        occasion: draftNow.occasion,
        media_kind: draftNow.mediaKind,
        duration_hours: draftNow.durationHours,
        social_tier: draftNow.social?.id,
        area: draftNow.area,
        meeting_point: draftNow.meetingPoint || undefined,
        meeting_lat: draftNow.meetingLat ?? undefined,
        meeting_lng: draftNow.meetingLng ?? undefined,
        date: draftNow.date,
        time: draftNow.time,
        creator_id: isServerCreatorId(draftNow.creatorId) ? draftNow.creatorId : undefined,
        addons: {
          rush: addons.includes('rush'),
          extra_photos: addons.includes('extra-photos'),
          extra_revisions: addons.includes('revision') ? 1 : 0,
        },
      });

      if (outcome.ok) {
        router.dismissAll();
        // The webhook creates the booking; if it hasn't landed yet the
        // booking is still coming, so the list is the honest destination.
        router.replace(outcome.bookingId ? `/bookings/${outcome.bookingId}` : '/(app)/bookings');
        return true;
      }
      if (outcome.reason === 'conflict') {
        setConflict(outcome.conflict);
        return false;
      }
      if (outcome.reason === 'paid_unconfirmed') {
        setBookError(
          'Your payment went through, but we haven\'t been able to confirm the booking yet. ' +
            'Do NOT pay again — check Bookings in a minute, and contact support with reference ' +
            `${outcome.paymentIntentId.slice(-8)} if it doesn't appear.`,
        );
        return false;
      }
      // Cancelled or declined: nothing exists to clean up.
      setBookError(
        outcome.reason === 'cancelled'
          ? 'Payment cancelled — nothing was charged and nothing was booked.'
          : outcome.message ?? 'Payment failed — no charge was made. Please try again.',
      );
      return false; // slider unlocks for a retry
    }
    const booking = confirmDraft(base + addonsTotal);
    router.dismissAll();
    router.replace(`/bookings/${booking.id}`);
    return true;
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Order summary" />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Booking card */}
        <View style={styles.card}>
          {creator && (
            <View style={styles.creatorRow}>
              <View style={[styles.creatorPhoto, { backgroundColor: creator.tint }]}>
                <CreatorAvatar name={creator.name} photo={creator.photo} textSize={16} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.creatorTitle}>
                  {creator.name} · {pkgLabel}
                </Text>
                <Text style={styles.creatorSub}>
                  {draft.occasion ?? '—'} ·{' '}
                  {draft.social
                    ? `${draft.social.label} bundle (${draft.social.duration_hours}h)`
                    : duration?.label ?? '—'}
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
            <Text style={styles.etaText}>
              {addons.includes('rush')
                ? 'Rush: edited content delivered within 6 hours of your session.'
                : 'Edited content is delivered within 24 hours of your session.'}
            </Text>
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
          {visibleAddons.map((a, i) => {
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
            {/* Total = sum of the converted lines above, so the breakdown
                always adds up on screen (rounding absorbed here). */}
            <Text style={styles.totalValue}>
              {formatMoneyTotal([base, addonsTotal, serviceFee], currency)}
            </Text>
          </View>
          {currency === 'XCD' && (
            <Text style={styles.usdChargeNote}>
              You'll be charged {formatMoney(total, 'USD')} USD — XCD figures are approximate.
            </Text>
          )}
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
        {timeNote ? <Text style={styles.timeNote}>{timeNote}</Text> : null}
        <Text style={styles.usdNote}>
          {currency === 'XCD' ? `≈ ${formatMoney(total, 'XCD')} · ` : ''}
          {USD_PROCESSING_NOTE}
        </Text>
        <View style={{ height: 24 }} />
      </KeyboardScrollView>

      <SlotRecoverySheet
        conflict={conflict}
        creatorName={creator?.name?.split(' ')[0] ?? null}
        chosenTime={draft.time}
        onPickTime={(time) => {
          setDraftTime(time);
          setConflict(null);
        }}
        onRematch={() => {
          // Keep the time; drop the specific creator so the server
          // auto-assigns from whoever is free in this slot.
          useBookings.getState().setDraft({ creatorId: null });
          setConflict(null);
          setTimeNote("We'll match you with another available creator for the same time.");
        }}
        onEditDetails={() => {
          setConflict(null);
          router.back();
        }}
        onClose={() => setConflict(null)}
      />
      <View style={styles.footer}>
        {/* Failures render HERE, pinned above the button — a message up in
            the scroll content can sit outside the viewport at the exact
            moment someone wonders why nothing happened. */}
        {bookError ? <Text style={styles.footerError}>{bookError}</Text> : null}
        {busy && !!stage && <Text style={styles.footerStage}>{stage}</Text>}
        <View style={styles.payBar}>
          <Text style={styles.payBarLabel}>You're paying (USD)</Text>
          <Text style={styles.payBarValue}>{formatMoney(total, 'USD')}</Text>
        </View>
        {/* A PLAIN BUTTON, not slide-to-confirm. The slider is reserved for
            irreversible commitments; this opens Stripe's sheet, where the
            Pay button is the single real confirmation. Two commit gestures
            for one action taught people to swipe past the one that counts. */}
        <Button
          title={busy ? 'Working…' : 'Continue to payment'}
          arrow
          loading={busy}
          onPress={book}
        />
      </View>
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
  payError: { fontSize: 13, fontWeight: '600', color: colors.error, marginTop: 12 },
  securedRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginBottom: 18, paddingHorizontal: 2 },
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
  usdChargeNote: { fontSize: 11, color: colors.grey, fontWeight: '600', marginTop: 2 },
  usdNote: { fontSize: 11, color: colors.grey, lineHeight: 15.5, marginTop: 10, textAlign: 'center' },
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
  timeNote: { fontSize: 12.5, fontWeight: '700', color: '#1E7A45', marginBottom: 8, textAlign: 'center' },
  footerError: { fontSize: 12.5, fontWeight: '700', color: '#A32C2C', textAlign: 'center', marginBottom: 10 },
  footerStage: { fontSize: 12, color: colors.grey, textAlign: 'center', marginBottom: 10 },
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
  // NO flexDirection:'row' — a leftover from the pre-restructure
  // <meta><Button> pair. With the single SlideToConfirm child it squeezed
  // the whole checkout control to content width (the cut-off "Slide…"
  // screenshot, 2026-08-08).
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
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
});
