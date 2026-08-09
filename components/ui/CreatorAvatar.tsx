import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';

/**
 * Fills its parent (which sets size/radius/tint background). Renders the
 * creator's photo — bundled asset or remote avatar_url — or an initial-letter
 * fallback for server creators without an uploaded avatar yet.
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
  React.useEffect(() => {
    setFailed(false); // a new photo deserves its own attempt
  }, [typeof photo === 'object' && photo !== null ? photo.uri : photo]);

  if (photo != null && !failed) {
    return (
      <Image
        source={photo}
        style={styles.fill}
        resizeMode="cover"
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
