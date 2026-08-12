import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '../../lib/text';
import { signedImageSource } from '../../lib/signedImage';

/**
 * Fills its parent (which sets size/radius/tint background). Renders the
 * person's APPROVED headshot from a signed URL, or an initial-letter
 * fallback — for someone with no approved photo, and for a signed URL that
 * fails to load. Those are the only two possibilities: bundled stock faces
 * were deleted, and profiles.avatar_url is gone.
 */
export function CreatorAvatar({
  name,
  photo,
  textSize = 20,
}: {
  name: string;
  photo: number | { uri: string } | null;
  textSize?: number;
}) {
  /**
   * A SIGNED URL THAT FAILS FALLS BACK TO INITIALS, never a broken image.
   * Headshot URLs are short-lived signed links to a private bucket, so an
   * expired or refused one is a normal event, not an exception — and a grey
   * torn-image box is a worse answer than the letter we already have.
   */
  const [failed, setFailed] = React.useState(false);
  // A string identity for the photo: callers build `{ uri }` inline, so the
  // object is new on every render and is useless as a dependency.
  const key = typeof photo === 'number' ? `bundled:${photo}` : (photo?.uri ?? '');
  React.useEffect(() => {
    setFailed(false); // a new photo deserves its own attempt
  }, [key]);

  const source = React.useMemo(() => {
    if (photo == null) return null;
    // A bundled require() is already a stable local asset — it needs no
    // cache key, and signing rules do not apply to it.
    return typeof photo === 'number' ? photo : signedImageSource(photo.uri);
  }, [key]);

  if (source != null && !failed) {
    return (
      <Image
        source={source}
        style={styles.fill}
        contentFit="cover"
        cachePolicy="memory-disk"
        /* Avatars are rendered in lists. Without this, a recycled row shows
           the PREVIOUS person's face until the new one decodes — briefly
           attaching the wrong name to the wrong photo. */
        recyclingKey={key}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.fill, styles.center]}>
      <Text style={{ fontSize: textSize, fontWeight: '800', color: 'rgba(0,0,0,0.4)' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
