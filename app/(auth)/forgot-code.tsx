import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CodeInput } from '../../components/ui/CodeInput';
import { realAuth, verifyResetCode } from '../../lib/auth';
import { colors } from '../../lib/theme';

// Real mode: GoTrue recovery OTP — verifying establishes a session so the
// next screen can set the new password. Mock keeps the 4-digit walkthrough.
export default function ForgotCode() {
  const router = useRouter();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const codeLength = realAuth ? 6 : 4;
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Set by CodeInput; pulls focus back to box one after a failure. */
  const focusFirst = React.useRef<(() => void) | null>(null);

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await verifyResetCode(String(email), code);
    setBusy(false);
    if (result.error) {
      // Clear and refocus so the next attempt starts at box one. The guard
      // stays ARMED against this code — a wrong one must never resubmit
      // itself.
      setError(result.error);
      setCode('');
      focusFirst.current?.();
      return;
    }
    router.push('/(auth)/forgot-reset');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Enter your code" />
      <View style={styles.body}>
        <Text style={styles.sub}>
          We sent a {codeLength}-digit code to{' '}
          <Text style={{ fontWeight: '800', color: colors.ink }}>{email}</Text>.
        </Text>
        <CodeInput
          length={codeLength}
          value={code}
          onChange={setCode}
          onComplete={verify}
          focusRef={focusFirst}
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Button
          title={busy ? 'Checking…' : 'Continue'}
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
  err: { fontSize: 12.5, color: colors.error, fontWeight: '600', textAlign: 'center' },
});
