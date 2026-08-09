import React from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import {
  AuthDecor,
  AuthInput,
  BackCircle,
  CountryCodePicker,
  CountryLockedCard,
  LogoTile,
  SocialButtons,
} from '../../components/auth/AuthBits';
import { Country, SAINT_LUCIA } from '../../lib/constants/countries';
import { realAuth, signUpWithEmail } from '../../lib/auth';
import { colors, insetBottom, insetTop } from '../../lib/theme';

// CD design signup: socials first, then full name, locked COUNTRY (Snapt is
// live in Saint Lucia only), phone with all-countries dial-code picker,
// email, password with Show toggle + live validation pills, Terms/Privacy
// links to the real published policies.
const PW_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: '8+ characters', test: (p) => p.length >= 8 },
  { label: '1 number', test: (p) => /\d/.test(p) },
  { label: '1 uppercase', test: (p) => /[A-Z]/.test(p) },
];

export default function Signup() {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [dial, setDial] = React.useState<Country>(SAINT_LUCIA);
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const pwOk = PW_RULES.every((r) => r.test(password));
  const canContinue = name.trim().length > 0 && email.includes('@') && pwOk && !busy;
  const phoneDigits = phone.replace(/\D/g, '');
  // E.164, matching the completion step — the old `+1758 5555555` shape left
  // three different formats in the profiles table.
  const fullPhone = phoneDigits ? `+${dial.dialCode}${phoneDigits}` : '';

  const handleContinue = async () => {
    setBusy(true);
    setError(null);
    const result = await signUpWithEmail(name.trim(), email.trim(), password);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const params = { name: name.trim(), email: email.trim(), phone: fullPhone };
    if (realAuth && !result.needsConfirmation) {
      router.push({ pathname: '/(auth)/onboarding-currency', params });
      return;
    }
    router.push({ pathname: '/(auth)/verify', params });
  };

  // Return key walks the form: name → phone → email → password.
  const phoneRef = React.useRef<RNTextInput>(null);
  const emailRef = React.useRef<RNTextInput>(null);
  const passwordRef = React.useRef<RNTextInput>(null);

  return (
    <View style={styles.root}>
      <AuthDecor />
      <KeyboardScrollView
        contentContainerStyle={styles.body}
       
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <BackCircle onPress={() => router.back()} />
        <View style={{ marginTop: 16 }}>
          <LogoTile size={54} />
        </View>
        <Text style={styles.title}>
          Create your <Text style={styles.titleAccent}>account</Text>
        </Text>
        <Text style={styles.sub}>Join Snapt to book creators and get pro edits.</Text>

        <SocialButtons />

        <View style={{ gap: 12, marginTop: 4 }}>
          <AuthInput icon="person" placeholder="Full name" value={name} onChangeText={setName} autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} />

          {/* Country — locked: Snapt is live in Saint Lucia only. Shared with
              the OAuth completion step so the two cannot diverge. */}
          <CountryLockedCard />

          {/* Phone: dial-code chip (all countries) + number. */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.dialChip}>
              <Text style={styles.flag}>{dial.flag}</Text>
              <Text style={styles.dialCode}>+{dial.dialCode}</Text>
              <Svg width={11} height={7} viewBox="0 0 11 7" fill="none">
                <Path d="M1 1l4.5 4.5L10 1" stroke="#767676" strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </Pressable>
            <View style={{ flex: 1 }}>
              <AuthInput icon="phone" inputRef={phoneRef} placeholder="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
            </View>
          </View>
          <Text style={styles.helper}>{dial.name}</Text>

          <AuthInput
            icon="mail"
            inputRef={emailRef}
            placeholder="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <AuthInput
            icon="lock"
            inputRef={passwordRef}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            right={
              <Pressable onPress={() => setShowPw((s) => !s)}>
                <Text style={styles.show}>{showPw ? 'Hide' : 'Show'}</Text>
              </Pressable>
            }
          />
          <View style={styles.pillRow}>
            {PW_RULES.map((r) => {
              const ok = r.test(password);
              return (
                <View key={r.label} style={[styles.pill, ok && styles.pillOk]}>
                  <Text style={[styles.pillLabel, ok && styles.pillLabelOk]}>{r.label}</Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.terms}>
            By continuing, you agree to Snapt's{' '}
            <Text style={styles.termsLink} onPress={() => router.push('/legal/terms')}>
              Terms
            </Text>{' '}
            &{' '}
            <Text style={styles.termsLink} onPress={() => router.push('/legal/privacy')}>
              Privacy Policy
            </Text>
            .
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <View style={{ height: 20 }} />
      </KeyboardScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleContinue}
          disabled={!canContinue}
          style={[styles.cta, !canContinue && { opacity: 0.5 }]}
        >
          <Text style={styles.ctaLabel}>{busy ? 'Creating account…' : 'Create account'}</Text>
        </Pressable>
        <Text style={styles.switchLine}>
          Already have an account?{' '}
          <Text style={styles.switchLink} onPress={() => router.replace('/(auth)/login')}>
            Log in
          </Text>
        </Text>
      </View>

      <CountryCodePicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setDial} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F1E8' },
  body: { paddingHorizontal: 22, paddingTop: insetTop + 10 },
  title: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, marginTop: 14 },
  titleAccent: { color: '#F2A93B', fontWeight: '800', fontSize: 27, letterSpacing: -0.6 },
  sub: { fontSize: 13.5, color: colors.grey, marginTop: 6, marginBottom: 18 },
  countryCard: {
    minHeight: 58,
    borderRadius: 15,
    backgroundColor: '#EDE8DC',
    borderWidth: 1,
    borderColor: '#E2DCCD',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  countryLabel: { fontSize: 9.5, fontWeight: '800', color: '#8A8377', letterSpacing: 0.7, marginBottom: 3 },
  countryName: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  flag: { fontSize: 18 },
  helper: { fontSize: 11, color: '#A8A29A', marginTop: -4, marginLeft: 4 },
  dialChip: {
    height: 52,
    borderRadius: 15,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E3DA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
  },
  dialCode: { fontSize: 14, fontWeight: '700', color: colors.ink },
  show: { fontSize: 13, fontWeight: '700', color: '#F2A93B' },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#EDE8DC',
    borderWidth: 1,
    borderColor: '#E2DCCD',
  },
  pillOk: { backgroundColor: '#E6F7EE', borderColor: '#BFE8D2' },
  pillLabel: { fontSize: 11, fontWeight: '700', color: '#8A8377' },
  pillLabelOk: { color: '#1E7A45' },
  terms: { fontSize: 11.5, color: '#8A8377', lineHeight: 17, marginTop: 2 },
  termsLink: { fontSize: 11.5, fontWeight: '800', color: '#B98600' },
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
