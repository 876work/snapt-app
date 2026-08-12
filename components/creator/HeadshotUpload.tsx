import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';
import { pickMedia } from '../../lib/pickMedia';

/**
 * Headshot picker + upload. Used in the creator application (required) and
 * in the creator profile (backfill / replace).
 *
 * Guidance is on-screen, not in a help page: the photo IS the first thing
 * clients judge a creator by, and a dark, cropped, or group shot costs
 * bookings before a word is exchanged.
 */
export function HeadshotUpload({
  currentUrl,
  status,
  onUploaded,
}: {
  /** Signed URL of the existing headshot, if any. */
  currentUrl?: string | null;
  status?: 'pending' | 'approved' | 'rejected' | null;
  onUploaded: () => void;
}) {
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pick = async () => {
    setError(null);
    // allowsEditing + a square aspect applies to a capture too: the OS shows
    // its crop step after the shutter, so a camera headshot arrives framed
    // the same way a chosen one does.
    const result = await pickMedia(
      { allowsEditing: true, aspect: [1, 1], quality: 0.9 },
      { title: 'Add your headshot', camera: 'Take a photo', library: 'Choose from library' },
    );
    if (!result || result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    setBusy(true);
    const { apiConfigured, uploadHeadshotApi } = await import('../../lib/api');
    if (!apiConfigured) {
      // Mock mode: preview only.
      setPreview(a.uri);
      setBusy(false);
      onUploaded();
      return;
    }
    const r = await uploadHeadshotApi({
      uri: a.uri,
      name: a.fileName ?? `headshot-${Date.now()}.jpg`,
      mimeType: a.mimeType ?? 'image/jpeg',
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPreview(a.uri);
    onUploaded();
  };

  const shown = preview ?? currentUrl ?? null;

  return (
    <View>
      <View style={styles.row}>
        <Pressable onPress={pick} style={styles.photoWrap} disabled={busy}>
          {shown ? (
            <Image source={{ uri: shown }} style={styles.photo} resizeMode="cover" />
          ) : (
            <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
              <Circle cx="12" cy="8.5" r="3.6" stroke={colors.greyLight} strokeWidth={2} />
              <Path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" stroke={colors.greyLight} strokeWidth={2} strokeLinecap="round" />
            </Svg>
          )}
          {busy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {shown ? 'Your headshot' : 'Add your headshot'}
            <Text style={styles.req}> · required</Text>
          </Text>
          <Text style={styles.guide}>
            A clear, friendly photo of just you, facing the camera in good light — like you'd
            greet a client. No sunglasses, logos, group shots, or heavy filters.
          </Text>
          {status === 'pending' && preview == null && (
            <Text style={styles.statusPending}>In review — visible to clients once approved.</Text>
          )}
          {status === 'rejected' && preview == null && (
            <Text style={styles.statusRejected}>
              Needs a retake — the last upload didn't meet the guidelines. Tap to replace it.
            </Text>
          )}
          <Pressable onPress={pick} hitSlop={8} disabled={busy}>
            <Text style={styles.action}>{shown ? 'Replace photo' : 'Choose photo'}</Text>
          </Pressable>
        </View>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  photoWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#F1EEE7',
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26,26,26,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '800', color: colors.ink },
  req: { fontSize: 11.5, fontWeight: '700', color: colors.yellowDark },
  guide: { fontSize: 12, color: colors.grey, lineHeight: 17.5, marginTop: 4 },
  statusPending: { fontSize: 11.5, fontWeight: '700', color: '#8A6800', marginTop: 6 },
  statusRejected: { fontSize: 11.5, fontWeight: '700', color: '#A32C2C', marginTop: 6 },
  action: { fontSize: 12.5, fontWeight: '800', color: colors.goldText, marginTop: 7 },
  error: { fontSize: 12, fontWeight: '700', color: '#A32C2C', marginTop: 8 },
});
