import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '../lib/text';
import { colors } from '../lib/theme';

/**
 * Landing route for Stripe's 3D Secure return (snapt://stripe-redirect?...).
 *
 * Without this file expo-router has nothing to match and shows "Unmatched
 * Route", stranding a client who has just authenticated with their bank —
 * they have paid and cannot get back into the app.
 *
 * The Stripe SDK consumes the URL itself and resolves presentPaymentSheet,
 * so the checkout screen underneath finishes the flow. This screen only
 * covers the moment in between, and gets out of the way if the SDK never
 * reports back (e.g. the challenge was abandoned).
 */
export default function StripeRedirect() {
  const router = useRouter();

  React.useEffect(() => {
    // Safety net only: if the SDK resolved, checkout has already navigated
    // and this unmounts long before the timer fires.
    const t = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/(app)/bookings');
    }, 8000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.yellowDark} />
      <Text style={styles.title}>Finishing your payment…</Text>
      <Text style={styles.sub}>
        Your bank approved the payment. Hold on a moment while we confirm your booking.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: colors.offWhite },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19 },
});
