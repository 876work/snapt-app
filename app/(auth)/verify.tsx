import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CodeInput } from '../../components/ui/CodeInput';
import { colors } from '../../lib/theme';

export default function Verify() {
  const router = useRouter();
  const { name = '', email = '' } = useLocalSearchParams<{ name?: string; email?: string }>();
  const [code, setCode] = React.useState('');

  return (
    <View style={styles.root}>
      <ScreenHeader title="Verify your email" />
      <View style={styles.body}>
        <Text style={styles.sub}>
          We sent a 4-digit code to <Text style={{ fontWeight: '800', color: colors.ink }}>{email}</Text>.
          Enter it below to confirm your account.
        </Text>
        <CodeInput value={code} onChange={setCode} />
        <Text style={styles.resend}>Didn't get it? Resend code</Text>
        <Button
          title="Verify"
          arrow
          disabled={code.length < 4}
          onPress={() =>
            router.push({ pathname: '/(auth)/onboarding-currency', params: { name, email } })
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 24 },
  sub: { fontSize: 13.5, lineHeight: 19.5, color: colors.grey },
  resend: { fontSize: 13, fontWeight: '700', color: colors.yellowDark, textAlign: 'center' },
});
