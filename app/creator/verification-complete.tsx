import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../../lib/text';
import { apiBase, authHeaders } from '../../lib/api';
import { colors } from '../../lib/theme';

/**
 * Landing route for Didit's callback (snapt://creator/verification-complete).
 *
 * Without this, finishing an ID check drops the creator on expo-router's
 * "Unmatched Route" — the same dead end the Stripe 3D Secure return hit.
 *
 * The decision itself arrives by WEBHOOK, so this screen never reports an
 * outcome from the URL. It reads our own server for the rolled-up status,
 * and always offers a way back into the application.
 */
export default function VerificationComplete() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!apiBase) {
        if (!cancelled) setChecking(false);
        return;
      }
      // The webhook may land a moment after the redirect; poll briefly.
      for (let i = 0; i < 6; i += 1) {
        try {
          const res = await fetch(`${apiBase}/v1/creator/verification`, { headers: await authHeaders() });
          if (res.ok) {
            const body = (await res.json()) as { status: string };
            if (cancelled) return;
            setStatus(body.status);
            if (body.status !== 'in_progress') break;
          }
        } catch {
          /* keep trying — the result is safe on the server either way */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const done = status === 'approved';
  const failed = status === 'declined' || status === 'failed_underage';

  return (
    <View style={styles.root}>
      {checking && !status ? (
        <>
          <ActivityIndicator color={colors.yellowDark} />
          <Text style={styles.title}>Checking your documents…</Text>
          <Text style={styles.sub}>This usually takes a few seconds.</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>
            {done ? 'Identity verified' : failed ? "We couldn't verify that" : 'Thanks — we have your documents'}
          </Text>
          <Text style={styles.sub}>
            {done
              ? 'Your ID and selfie matched. Carry on with your application.'
              : failed
                ? "You can try once more from the application, or submit anyway — our team will check by hand."
                : "We're still checking. You can carry on and submit — we'll finish in the background."}
          </Text>
        </>
      )}
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/creator/apply'))}
        style={styles.cta}
      >
        <Text style={styles.ctaLabel}>Back to my application</Text>
      </Pressable>
      {params.status ? <Text style={styles.meta}>Reported by verification: {params.status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30, backgroundColor: colors.offWhite },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 13.5, color: colors.grey, textAlign: 'center', lineHeight: 20 },
  cta: {
    marginTop: 10,
    height: 50,
    paddingHorizontal: 26,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 11.5, color: '#9A9A9A', marginTop: 4 },
});
