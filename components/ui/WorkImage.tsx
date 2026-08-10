import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';

/**
 * A portfolio shot, with an HONEST failure state.
 *
 * These are short-lived signed links to a private bucket, and on production
 * some registered objects 404 outright — so the card rendered a blank grey
 * box beside a badge reading "2 shots". That is the failure-as-normal problem
 * again: it reads as an empty or bad portfolio, when the truth is the image
 * did not load. A creator loses work to that; we lose trust.
 *
 * Same contract as CreatorAvatar: onError flips to a stated fallback, and a
 * new URL gets its own attempt.
 */
export function WorkImage({
  uri,
  style,
  label = "Preview didn't load",
}: {
  uri: string | null | undefined;
  style?: object;
  label?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.fill, style]}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View style={[styles.fill, styles.fallback, style]}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5v-11z"
          stroke={colors.greyWarm}
          strokeWidth={1.7}
        />
        <Path d="M5 16l4-4 3 3 3-3 4 4" stroke={colors.greyWarm} strokeWidth={1.7} strokeLinejoin="round" />
        <Path d="M4 4l16 16" stroke={colors.greyWarm} strokeWidth={1.7} strokeLinecap="round" />
      </Svg>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#F1EEE7',
    paddingHorizontal: 10,
  },
  label: { fontSize: 10, color: colors.greyWarm, fontWeight: '700', textAlign: 'center' },
});
