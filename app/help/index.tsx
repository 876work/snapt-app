import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card } from '../../components/ui/Misc';
import { colors, spacing } from '../../lib/theme';

/**
 * FAQ answers, written from the LIVE policy documents and the code that
 * enforces them — never invented. Every figure here was checked against its
 * source: the 15-minute offer window is offer_window_minutes, the refund
 * tiers are fees.ts (>48h / 24-48h / under 24h, service fee kept at every
 * one), and a creator cancellation refunds booking.price_usd, which is the
 * whole charge including the fee.
 *
 * Delivery hours are the ONE thing not written here: they come from the
 * delivery_windows config at render time, because an admin can change them
 * and a hardcoded "24 hours" would quietly become a lie the moment they do.
 */
const faqs = (standardHours: number, rushHours: number) => [
  {
    q: 'How do bookings work?',
    a: `You pay first, and only then do we look for a creator — nothing is reserved before payment, so you are never holding a slot that is not really yours. The booking goes to the best-matched available creator, who has 15 minutes to accept. If they pass, it rolls straight to the next creator automatically. Once someone accepts, your booking is confirmed and they are on your schedule. For in-person sessions you get a 4-digit safety code; your creator asks for it when they arrive, and the session only starts once you have given it to them.`,
  },
  {
    q: 'What happens if my creator cancels?',
    a: `You get a full refund automatically — the whole amount, including the service fee. You do not have to ask, and there is no fee of any kind for a cancellation that was not yours. We will also offer to rematch you with another creator for the same slot, which you can accept or decline from the booking.`,
  },
  {
    q: 'When do I get my photos?',
    a: `Standard delivery is within ${standardHours} hours. If you added rush at checkout, it is ${rushHours} hours. The clock starts when the work starts — the end of your session for in-person bookings, or when your files finish uploading for a remote edit — not from when you booked. You will get a notification the moment your edits are ready.`,
  },
  {
    q: 'How do refunds work?',
    a: `It depends how much notice you give. More than 48 hours before your session: your session cost is refunded in full. Between 24 and 48 hours: half the session cost is refunded. Under 24 hours: the session cost is not refunded, because your creator has already turned down other work to hold that time. The service fee is kept at every tier — it covers payment processing and matching, which have already happened. If your creator cancels, none of this applies and you get everything back.`,
  },
];

export default function Help() {
  const router = useRouter();
  const [open, setOpen] = React.useState<number | null>(null);
  /**
   * Delivery promises come from live config so this screen and the delivery
   * clock can never disagree. The fallback matches the server default.
   */
  const [windows, setWindows] = React.useState({ standardHours: 24, rushHours: 6 });
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchPricingConfig }) => {
      if (!apiConfigured) return;
      fetchPricingConfig().then((c) => {
        if (c) setWindows({ standardHours: c.standardHours, rushHours: c.rushHours });
      });
    });
  }, []);
  const FAQS = faqs(windows.standardHours, windows.rushHours);
  return (
    <View style={styles.root}>
      <ScreenHeader title="Help & Support" />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={{ paddingVertical: 4, paddingHorizontal: 0 }}>
          {FAQS.map((item, i) => {
            const expanded = open === i;
            return (
              <View key={item.q} style={i < FAQS.length - 1 && styles.rowBorder}>
                {/* Accordion, not navigation: four short answers do not each
                    deserve a screen and a back tap to read. */}
                <Pressable
                  onPress={() => setOpen(expanded ? null : i)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  style={styles.row}
                >
                  <Text style={[styles.rowLabel, expanded && styles.rowLabelOpen]}>{item.q}</Text>
                  <Svg
                    width={12}
                    height={12}
                    viewBox="0 0 24 24"
                    style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
                  >
                    <Path d="M6 9l6 6 6-6" stroke={colors.greyLight} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Pressable>
                {expanded && <Text style={styles.answer}>{item.a}</Text>}
              </View>
            );
          })}
        </Card>
        <View style={{ gap: 10, marginTop: 18 }}>
          <Pressable onPress={() => router.push('/help/contact')} style={styles.cta}>
            <Text style={styles.ctaLabel}>Contact support</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/help/report')} style={[styles.cta, styles.ctaGhost]}>
            <Text style={[styles.ctaLabel, { color: colors.ink }]}>Report a problem</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  rowLabelOpen: { color: colors.ink, fontWeight: '800' },
  answer: {
    fontSize: 13,
    color: colors.grey,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    marginTop: -2,
  },
  cta: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
