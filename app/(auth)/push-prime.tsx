import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../lib/store';
import { colors } from '../../lib/theme';

// Permission priming — shown once before the native OS push dialog fires.
// "Not now" is respected: no in-app re-prompt; re-enable lives in
// Notification settings (handoff §13).
export default function PushPrime() {
  const router = useRouter();
  const { name = '', email = '' } = useLocalSearchParams<{ name?: string; email?: string }>();
  const signIn = useAuth((s) => s.signIn);

  const finish = () => {
    signIn(String(name) || 'You', String(email));
    router.replace('/(app)/home');
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
        <Text style={styles.sub}>
          We'll only notify you about things that matter — booking confirmations, your creator on
          the way, and your photos arriving. No spam.
        </Text>
        <Button title="Turn on notifications" arrow onPress={finish} />
        <Pressable onPress={finish}>
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
  sub: { fontSize: 14.5, lineHeight: 21, color: colors.grey, marginBottom: 10 },
  notNow: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.grey,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
