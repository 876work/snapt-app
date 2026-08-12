import React from 'react';
import { BackHandler, Pressable, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  AuthDecor,
  AuthInput,
  CountryCodePicker,
  CountryLockedCard,
  LogoTile,
} from '../../components/auth/AuthBits';
import { Country, SAINT_LUCIA } from '../../lib/constants/countries';
import { saveProfile } from '../../lib/auth';
import { joinName, splitName } from '../../lib/name';
import { landingAfterAuth } from '../../lib/notificationTarget';
import { useAuth } from '../../lib/store';
import { colors, insetBottom, insetTop } from '../../lib/theme';

/**
 * PROFILE COMPLETION — the four required fields, whatever the signup method.
 *
 * Google and Apple hand back a name and an email and nothing else, so an
 * OAuth account used to reach Home with no phone number at all. A creator
 * cannot ring a doorbell. This closes that, and it is deliberately the same
 * form the email signup uses (AuthInput, the locked country card, the
 * dial-code picker) rather than a second one that drifts.
 *
 * NON-SKIPPABLE, on purpose:
 *   - no back control, and Android's hardware back is swallowed
 *   - no "later" — a phone number collected later is a phone number missing
 *     on the booking that needed it
 *
 * It is NOT the security boundary. The server refuses checkout and creator
 * applications on an incomplete profile regardless of what the app shows
 * (server/src/profile-complete.ts); this screen exists so the refusal never
 * has to happen.
 */
export default function CompleteProfile() {
  const router = useRouter();
  const { next, first: firstParam, last: lastParam } = useLocalSearchParams<{
    next?: string;
    first?: string;
    last?: string;
  }>();
  const storeName = useAuth((s) => s.name);
  const storeEmail = useAuth((s) => s.email);
  const storePhone = useAuth((s) => s.phone);

  // Prefilled with whatever the provider did give us, and still editable —
  // Apple in particular hands over a name exactly once, and it is often not
  // the name someone wants a creator to call them.
  //
  // Google and Apple both return givenName/familyName SEPARATELY and we used
  // to join them and throw the structure away. When those parts came through
  // they are used directly; the space-split is only the fallback for a
  // provider that gave a single joined string, or for an older account that
  // reached this screen with nothing but a stored full_name.
  const seeded = React.useMemo(() => {
    if (firstParam || lastParam) return { first: firstParam ?? '', last: lastParam ?? '' };
    return splitName(storeName);
  }, [firstParam, lastParam, storeName]);
  const [firstName, setFirstName] = React.useState(seeded.first);
  const [lastName, setLastName] = React.useState(seeded.last);
  const [dial, setDial] = React.useState<Country>(SAINT_LUCIA);
  const [phone, setPhone] = React.useState(storePhone ?? '');
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Android hardware back: swallowed while this screen is mounted. Without
  // this the step is skippable with one gesture on most of the install base.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const digits = phone.replace(/\D/g, '');
  // E.164 — one stored shape. The three phone numbers already in production
  // are in three different formats because nothing ever normalised them.
  const e164 = digits ? `+${dial.dialCode}${digits}` : '';
  // Both halves required here too — this is still first capture of the name.
  const name = joinName(firstName, lastName);
  const canContinue =
    firstName.trim().length > 0 && lastName.trim().length > 0 && digits.length >= 7 && !busy;

  const submit = async () => {
    if (!canContinue) return;
    setBusy(true);
    setError(null);
    const result = await saveProfile({
      name,
      email: storeEmail ?? '',
      phone: e164,
      country: SAINT_LUCIA.iso2,
    });
    setBusy(false);
    if (result.error) {
      // Values stay exactly where they are. A failed save must never look
      // like a successful one, and must never cost someone their typing.
      setError(result.error);
      return;
    }
    if (next === 'onboarding') {
      // A brand-new OAuth account still owes the same onboarding an email
      // signup gets: currency, then push priming, which ends at
      // landingAfterAuth itself.
      router.replace({
        pathname: '/(auth)/onboarding-currency',
        params: { name, email: storeEmail ?? '' },
      });
      return;
    }
    // An existing account has already been through onboarding — straight to
    // wherever they were headed, honouring a parked deep link.
    router.replace((await landingAfterAuth()) as never);
  };

  const lastNameRef = React.useRef<RNTextInput>(null);
  const phoneRef = React.useRef<RNTextInput>(null);

  return (
    <View style={styles.root}>
      <AuthDecor />
      <KeyboardScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <View style={{ marginTop: insetTop + 6 }}>
          <LogoTile size={54} />
        </View>
        <Text style={styles.title}>
          One more <Text style={styles.titleAccent}>step</Text>
        </Text>
        <Text style={styles.sub}>
          We need a few details before you can book. Your creator uses these to reach you about
          your session.
        </Text>

        <View style={{ gap: 12, marginTop: 4 }}>
          <AuthInput
            icon="person"
            placeholder="First name"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            textContentType="givenName"
            returnKeyType="next"
            onSubmitEditing={() => lastNameRef.current?.focus()}
          />
          <AuthInput
            icon="person"
            inputRef={lastNameRef}
            placeholder="Last name"
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            textContentType="familyName"
            returnKeyType="next"
            onSubmitEditing={() => phoneRef.current?.focus()}
          />

          <CountryLockedCard />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.dialChip}>
              <Text style={styles.flag}>{dial.flag}</Text>
              <Text style={styles.dialCode}>+{dial.dialCode}</Text>
              <Svg width={11} height={7} viewBox="0 0 11 7" fill="none">
                <Path d="M1 1l4.5 4.5L10 1" stroke="#767676" strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </Pressable>
            <View style={{ flex: 1 }}>
              <AuthInput
                icon="phone"
                inputRef={phoneRef}
                placeholder="Phone number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                returnKeyType="done"
                onSubmitEditing={submit}
              />
            </View>
          </View>
          <Text style={styles.helper}>{dial.name}</Text>

          {/* Email is shown, never edited here: it is the identity the
              provider signed us in with, and changing it would fork the
              account away from the one Google or Apple returns next time. */}
          {storeEmail ? (
            <View style={styles.emailCard}>
              <Text style={styles.emailLabel}>EMAIL</Text>
              <Text style={styles.emailValue} numberOfLines={1}>
                {storeEmail}
              </Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <View style={{ height: 20 }} />
      </KeyboardScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={submit}
          disabled={!canContinue}
          style={[styles.cta, !canContinue && { opacity: 0.5 }]}
        >
          <Text style={styles.ctaLabel}>{busy ? 'Saving…' : 'Continue'}</Text>
        </Pressable>
      </View>

      <CountryCodePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={setDial}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F1E8' },
  body: { paddingHorizontal: 22, paddingTop: 10 },
  title: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, marginTop: 14 },
  titleAccent: { color: '#F2A93B', fontWeight: '800', fontSize: 27, letterSpacing: -0.6 },
  sub: { fontSize: 13.5, color: colors.grey, marginTop: 6, marginBottom: 18, lineHeight: 19 },
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
  flag: { fontSize: 18 },
  helper: { fontSize: 11, color: '#A8A29A', marginTop: -4, marginLeft: 4 },
  emailCard: {
    minHeight: 58,
    borderRadius: 15,
    backgroundColor: '#EDE8DC',
    borderWidth: 1,
    borderColor: '#E2DCCD',
    paddingHorizontal: 15,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  emailLabel: { fontSize: 9.5, fontWeight: '800', color: '#8A8377', letterSpacing: 0.7, marginBottom: 3 },
  emailValue: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
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
});
