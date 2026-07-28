import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { completePasswordReset, realAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function ForgotReset() {
  const router = useRouter();
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ok = pw.length >= 8 && pw === pw2 && !busy;

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await completePasswordReset(pw);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Real mode: the recovery session is now a normal signed-in session.
    if (realAuth) {
      router.replace('/(app)/home');
      return;
    }
    router.dismissTo('/(auth)/login');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Choose a new password" />
      <View style={styles.body}>
        <TextField
          label="New password"
          value={pw}
          onChangeText={setPw}
          secureTextEntry
          placeholder="At least 8 characters"
        />
        <TextField label="Confirm password" value={pw2} onChangeText={setPw2} secureTextEntry />
        {pw2.length > 0 && pw !== pw2 && (
          <Text style={styles.err}>Passwords don't match yet.</Text>
        )}
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Button title={busy ? 'Saving…' : 'Reset password'} arrow disabled={!ok} onPress={reset} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 16 },
  err: { fontSize: 12.5, color: colors.error, fontWeight: '600' },
});
