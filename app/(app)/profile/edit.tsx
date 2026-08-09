import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { CreatorAvatar } from '../../../components/ui/CreatorAvatar';
import { HeadshotUpload } from '../../../components/creator/HeadshotUpload';
import { useAuth } from '../../../lib/store';
import { realAuth, saveProfile } from '../../../lib/auth';
import { colors, spacing, insetBottom } from '../../../lib/theme';

export default function EditProfile() {
  const router = useRouter();
  const { name, email, phone } = useAuth();
  const [n, setN] = React.useState(name);
  const [e, setE] = React.useState(email);
  const [p, setP] = React.useState(phone);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * THE APPROVED HEADSHOT IS THE PROFILE PHOTO.
   *
   * This screen previously rendered an initial-letter tile and nothing else —
   * no <Image> anywhere in it — so a creator with a vetted, client-facing
   * photo was shown a letter as though they had never uploaded one.
   *
   * `headshot_url` is signed for the OWNER at any status, deliberately: you
   * should see the photo you just submitted. `pending` is labelled rather
   * than hidden, so nobody assumes a photo awaiting review is already public.
   */
  const [photo, setPhoto] = React.useState<{ uri: string } | null>(null);
  const [pendingUrl, setPendingUrl] = React.useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = React.useState<string | null>(null);
  const [isCreator, setIsCreator] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const loadPhoto = React.useCallback(async () => {
    const { apiConfigured, fetchCreatorMe } = await import('../../../lib/api');
    if (!apiConfigured) return;
    const me = await fetchCreatorMe();
    // A failed read leaves initials — never assert "no photo" from a request
    // that did not answer.
    if (!me) return;
    setIsCreator(true);
    setPhotoStatus(me.headshot_status ?? null);
    setPendingUrl(me.headshot_pending_url ?? null);
    setPhoto(me.headshot_url ? { uri: me.headshot_url } : null);
  }, []);
  React.useEffect(() => {
    loadPhoto();
  }, [loadPhoto]);

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
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
          <View style={styles.avatar}>
            <View style={styles.avatarClip}>
              <CreatorAvatar name={n || 'Y'} photo={photo} textSize={30} />
            </View>
            <View style={styles.cameraBadge}>
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Path d="M4 8a2 2 0 012-2h1.5l1-1.5h5l1 1.5H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" stroke="#fff" strokeWidth={1.9} strokeLinejoin="round" />
                <Circle cx="12" cy="12.5" r="3.2" stroke="#fff" strokeWidth={1.9} />
              </Svg>
            </View>
          </View>
          {/* Only creators have a reviewed photo. Pure clients keep initials
              (Don, 2026-08-09) — client photos are a post-launch feature and
              a half-built one is worse than none. */}
          {isCreator ? (
            <Pressable onPress={() => setPicking(true)} hitSlop={8}>
              <Text style={styles.changePhoto}>Change photo</Text>
            </Pressable>
          ) : null}
          {pendingUrl != null && (
            <Text style={styles.photoPending}>
              Your new photo is with us for review — clients keep seeing the one above until it's
              approved.
            </Text>
          )}
          {pendingUrl == null && photoStatus === 'rejected' && (
            <Text style={styles.photoPending}>
              Your last photo wasn't approved. Upload a clear, front-facing photo of just you.
            </Text>
          )}
          {pendingUrl == null && photo != null && photoStatus === 'pending' && (
            <Text style={styles.photoPending}>
              Awaiting review — it isn't visible to clients yet.
            </Text>
          )}
        </View>

        {picking && (
          <View style={{ marginBottom: 22 }}>
            <HeadshotUpload
              currentUrl={pendingUrl ?? photo?.uri ?? null}
              status={photoStatus as 'pending' | 'approved' | 'rejected' | null}
              onUploaded={() => {
                setPicking(false);
                loadPhoto();
              }}
            />
          </View>
        )}

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
      </KeyboardScrollView>
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
  /**
   * The photo clips to the circle HERE rather than on the parent — the camera
   * badge is positioned at -2 and overhangs deliberately, so clipping the
   * outer box would slice it in half.
   */
  avatarClip: { width: '100%', height: '100%', borderRadius: 46, overflow: 'hidden' },

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
  photoPending: {
    fontSize: 11.5,
    color: colors.grey,
    lineHeight: 16.5,
    textAlign: 'center',
    marginTop: 7,
    paddingHorizontal: 24,
  },
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
    paddingBottom: Math.max(insetBottom + 12, 30),
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
