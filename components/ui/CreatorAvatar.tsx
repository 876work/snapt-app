import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

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
  if (photo != null) {
    return <Image source={photo} style={styles.fill} resizeMode="cover" />;
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
