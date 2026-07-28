import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CodeInput } from '../../components/ui/CodeInput';
import { realAuth, resendSignupCode, verifySignupCode } from '../../lib/auth';
import { colors } from '../../lib/theme';

// Real mode: GoTrue email confirmation (6-digit OTP, verified server-side —
// a session only exists after this succeeds). Mock mode keeps the designed
// 4-digit walkthrough.
export default function Verify() {
  const router = useRouter();
  const { name = '', email = '' } = useLocalSearchParams<{ name?: string; email?: string }>();
  const codeLength = realAuth ? 6 : 4;
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resent, setResent] = React.useState(false);

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await verifySignupCode(String(email), code);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push({ pathname: '/(auth)/onboarding-currency', params: { name, email } });
  };

  const resend = async () => {
    setError(null);
    const result = await resendSignupCode(String(email));
    if (result.error) {
      setError(result.error);
      return;
    }
    setResent(true);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Verify your email" />
      <View style={styles.body}>
        <Text style={styles.sub}>
          We sent a {codeLength}-digit code to{' '}
          <Text style={{ fontWeight: '800', color: colors.ink }}>{email}</Text>. Enter it below to
          confirm your account.
        </Text>
        <CodeInput length={codeLength} value={code} onChange={setCode} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={resend} disabled={resent}>
          <Text style={styles.resend}>{resent ? 'Code re-sent — check your inbox.' : "Didn't get it? Resend code"}</Text>
        </Pressable>
        <Button
          title={busy ? 'Verifying…' : 'Verify'}
          arrow
          disabled={code.length < codeLength || busy}
          onPress={verify}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 24 },
  sub: { fontSize: 13.5, lineHeight: 19.5, color: colors.grey },
  error: { fontSize: 12.5, fontWeight: '600', color: '#B4442E', textAlign: 'center' },
  resend: { fontSize: 13, fontWeight: '700', color: colors.yellowDark, textAlign: 'center' },
});
