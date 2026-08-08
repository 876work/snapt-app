import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../lib/store';
import { realAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import { landingAfterAuth } from '../../lib/notificationTarget';

// Permission priming — shown once before the native OS push dialog fires.
// "Not now" is respected: no in-app re-prompt; re-enable lives in
// Notification settings (handoff §13).
export default function PushPrime() {
  const router = useRouter();
  const { name = '', email = '' } = useLocalSearchParams<{ name?: string; email?: string }>();
  const signIn = useAuth((s) => s.signIn);

  const finish = async () => {
    // Real mode: the Supabase session (established at signup or code verify)
    // drives the store via onAuthStateChange — a mock signIn here would fake
    // a signed-in UI with no session behind it.
    if (!realAuth) signIn(String(name) || 'You', String(email));
    router.replace((await landingAfterAuth()) as never);
  };

  const enable = async () => {
    // Fires the real OS permission dialog, registers the Expo push token,
    // then continues either way — "Not now" semantics are preserved by the
    // OS denial itself (no in-app re-prompt, per §13).
    const { enablePush } = await import('../../lib/push');
    await enablePush();
    finish();
  };

  return (
    <View style={styles.root}>
      <View style={styles.art}>
        <Svg width={72} height={72} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 3a6 6 0 00-6 6v3.3c0 .6-.2 1.2-.6 1.7L4 16h16l-1.4-2a2.9 2.9 0 01-.6-1.7V9a6 6 0 00-6-6z"
            fill={colors.yellow}
          />
          <Path d="M9.5 19a2.5 2.5 0 005 0" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
          <Circle cx="17.5" cy="6.5" r="3" fill={colors.error} />
        </Svg>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Stay in the loop</Text>
        <Text style={styles.sub}>Here's exactly what we send — and nothing else:</Text>
        <View style={styles.list}>
          <Text style={styles.listItem}>✓  Booking confirmations</Text>
          <Text style={styles.listItem}>✓  Your creator is on the way</Text>
          <Text style={styles.listItem}>✓  Your photos & videos are ready</Text>
          <Text style={styles.listItem}>✓  Session reminders</Text>
        </View>
        <Text style={styles.subSmall}>No promotions unless you opt in. No spam, ever.</Text>
        <Button title="Turn on notifications" arrow onPress={enable} />
        <Pressable
          onPress={() => {
            // Record the dismissal so "declined" is distinguishable from
            // "never asked" when a missing token is diagnosed later.
            import('../../lib/push').then((m) => m.recordPrimeDismissed());
            finish();
          }}
        >
          <Text style={styles.notNow}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  art: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 24, paddingBottom: 52, gap: 14 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, color: colors.ink },
  sub: { fontSize: 14.5, lineHeight: 21, color: colors.grey },
  list: { gap: 7, paddingVertical: 4 },
  listItem: { fontSize: 14.5, lineHeight: 20, color: colors.ink, fontWeight: '600' },
  subSmall: { fontSize: 12.5, lineHeight: 18, color: colors.greyWarm, marginBottom: 10 },
  notNow: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.grey,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
