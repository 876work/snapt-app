import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { AuthDecor, AuthInput, BackCircle, LogoTile, SocialButtons } from '../../components/auth/AuthBits';
import { signInWithEmail } from '../../lib/auth';
import { colors, insetBottom, insetTop } from '../../lib/theme';

// CD design login: socials first, then email + password, forgot link,
// yellow Log in pinned to the bottom with the Sign up switch line.
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
      <AuthDecor />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <BackCircle onPress={() => router.back()} />
        <View style={{ marginTop: 16 }}>
          <LogoTile size={54} />
        </View>
        <Text style={styles.title}>
          Welcome <Text style={styles.titleAccent}>back</Text>
        </Text>
        <Text style={styles.sub}>Log in to book creators, manage bookings, and pick up where you left off.</Text>

        <SocialButtons />

        <View style={{ gap: 12, marginTop: 4 }}>
          <AuthInput
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <AuthInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
          <Pressable onPress={() => router.push('/(auth)/forgot')} style={{ alignSelf: 'flex-end' }}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <View style={{ height: 20 }} />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleLogin}
          disabled={!canContinue}
          style={[styles.cta, !canContinue && { opacity: 0.5 }]}
        >
          <Text style={styles.ctaLabel}>{busy ? 'Logging in…' : 'Log in'}</Text>
        </Pressable>
        <Text style={styles.switchLine}>
          New to Snapt?{' '}
          <Text style={styles.switchLink} onPress={() => router.replace('/(auth)/signup')}>
            Sign up
          </Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F1E8' },
  body: { paddingHorizontal: 22, paddingTop: insetTop + 10 },
  title: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, marginTop: 14 },
  titleAccent: { color: '#F2A93B', fontWeight: '800', fontSize: 27, letterSpacing: -0.6 },
  sub: { fontSize: 13.5, color: colors.grey, marginTop: 6, marginBottom: 18, lineHeight: 19 },
  forgot: { fontSize: 12.5, fontWeight: '700', color: '#B98600' },
  error: { fontSize: 12.5, fontWeight: '600', color: '#B4442E' },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: Math.max(insetBottom + 10, 26),
    backgroundColor: '#F5F1E8',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E4DFD4',
  },
  cta: {
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFB800',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 16, fontWeight: '800', color: '#1A1A1A' },
  switchLine: { fontSize: 12.5, color: '#8A8377', textAlign: 'center', marginTop: 12 },
  switchLink: { fontSize: 12.5, fontWeight: '800', color: '#B98600' },
});
