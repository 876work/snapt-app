import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../lib/text';
import { colors } from '../lib/theme';

/**
 * The landing for a link that doesn't resolve.
 *
 * expo-router renders its own "Unmatched Route" developer screen when this
 * file is absent — raw path, stack trace styling, no way out. That is what a
 * user saw if a notification ever pointed at a route that had moved or been
 * renamed.
 *
 * A dead link is our bug, not theirs, so this says so plainly and gives
 * them somewhere to go rather than asking them to force-quit.
 */
export default function NotFound() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={styles.badge}>
        <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 8.5v5m0 3.2v.1M10.3 3.9L2.5 17.4A2 2 0 004.2 20.4h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
            stroke={colors.yellowDark}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Text style={styles.title}>We couldn't open that</Text>
      <Text style={styles.body}>
        The link you followed points somewhere that no longer exists. Nothing is wrong with your
        account — whatever it was about is still in your bookings or notifications.
      </Text>
      <Pressable onPress={() => router.replace('/(app)/home')} style={styles.cta}>
        <Text style={styles.ctaLabel}>Go to Home</Text>
      </Pressable>
      <Pressable onPress={() => router.replace('/(app)/inbox')} hitSlop={8}>
        <Text style={styles.secondary}>Open notifications</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.offWhite,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
  },
  badge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  body: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  cta: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 28,
  },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  secondary: { fontSize: 13, fontWeight: '700', color: colors.goldText, marginTop: 16 },
});
