import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Divider } from '../../components/ui/Misc';
import { signInWithEmail } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const canContinue = email.includes('@') && password.length > 0 && !busy;

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    const result = await signInWithEmail(email.trim(), password);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace('/(app)/home');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Welcome back" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <Pressable onPress={() => router.push('/(auth)/forgot')}>
          <Text style={styles.forgot}>Forgot password?</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title={busy ? 'Logging in…' : 'Log in'} arrow disabled={!canContinue} onPress={handleLogin} />
        <Divider label="or continue with" />
        <View style={styles.oauthRow}>
          {['Google', 'Apple', 'Facebook'].map((p) => (
            <View key={p} style={styles.oauthBtn}>
              <Text style={styles.oauthLabel}>{p}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 40, gap: 16 },
  forgot: { fontSize: 13, fontWeight: '700', color: colors.yellowDark, alignSelf: 'flex-end' },
  error: { fontSize: 13, color: colors.error, fontWeight: '600' },
  oauthRow: { flexDirection: 'row', gap: 10 },
  oauthBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  oauthLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
});
