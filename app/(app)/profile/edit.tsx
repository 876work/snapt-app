import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { useAuth } from '../../../lib/store';
import { realAuth, saveProfile } from '../../../lib/auth';
import { colors, spacing } from '../../../lib/theme';

export default function EditProfile() {
  const router = useRouter();
  const { name, email, phone } = useAuth();
  const [n, setN] = React.useState(name);
  const [e, setE] = React.useState(email);
  const [p, setP] = React.useState(phone);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await saveProfile({ name: n, email: e, phone: p });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.back();
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Edit profile" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{(n || 'Y').charAt(0).toUpperCase()}</Text>
            <View style={styles.cameraBadge}>
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Path d="M4 8a2 2 0 012-2h1.5l1-1.5h5l1 1.5H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" stroke="#fff" strokeWidth={1.9} strokeLinejoin="round" />
                <Circle cx="12" cy="12.5" r="3.2" stroke="#fff" strokeWidth={1.9} />
              </Svg>
            </View>
          </View>
          <Text style={styles.changePhoto}>Change photo</Text>
        </View>

        <Text style={styles.fieldLabel}>FULL NAME</Text>
        <TextInput value={n} onChangeText={setN} placeholder="Your name" placeholderTextColor="#9A9A9A" style={styles.input} />
        <Text style={[styles.fieldLabel, { marginTop: 18 }]}>EMAIL</Text>
        <TextInput
          value={e}
          onChangeText={setE}
          placeholder="you@email.com"
          placeholderTextColor="#9A9A9A"
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!realAuth}
          style={[styles.input, realAuth && styles.inputDisabled]}
        />
        {realAuth && (
          <Text style={styles.lockedNote}>
            Your email is your sign-in — contact hello@snaptcarib.app to change it.
          </Text>
        )}
        <Text style={[styles.fieldLabel, { marginTop: 18 }]}>PHONE</Text>
        <TextInput
          value={p}
          onChangeText={setP}
          placeholder="Phone number"
          placeholderTextColor="#9A9A9A"
          keyboardType="phone-pad"
          style={styles.input}
        />
        <Text style={styles.note}>
          Your phone number is how we reach you for payout arrangements and booking updates.
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.cta, saving && { opacity: 0.6 }]}>
          <Text style={styles.ctaLabel}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#EFEBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 34, fontWeight: '800', color: '#8A7530' },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.offWhite,
  },
  changePhoto: { fontSize: 13, fontWeight: '700', color: colors.yellowDark, marginTop: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.greyWarm, letterSpacing: 0.3, marginHorizontal: 2, marginBottom: 7 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#E7E7E7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 14.5,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  inputDisabled: { backgroundColor: '#F4F2ED', color: '#9A948B' },
  lockedNote: { fontSize: 11, color: '#9A948B', marginTop: 6, paddingHorizontal: 2 },
  note: { fontSize: 11.5, color: '#9A948B', lineHeight: 17, marginTop: 14, paddingHorizontal: 2 },
  error: { fontSize: 12.5, fontWeight: '600', color: '#B4442E', marginTop: 12, paddingHorizontal: 2 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 16, fontWeight: '800', color: colors.ink },
});
