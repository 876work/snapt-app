import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { requestPasswordReset } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function Forgot() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await requestPasswordReset(email.trim());
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push({ pathname: '/(auth)/forgot-code', params: { email: email.trim() } });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Reset your password" />
      <View style={styles.body}>
        <Text style={styles.sub}>
          Enter the email on your account and we'll send you a reset code.
        </Text>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Button
          title={busy ? 'Sending…' : 'Send code'}
          arrow
          disabled={!email.includes('@') || busy}
          onPress={send}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 16 },
  sub: { fontSize: 13.5, lineHeight: 19.5, color: colors.grey },
  err: { fontSize: 12.5, color: colors.error, fontWeight: '600' },
});
