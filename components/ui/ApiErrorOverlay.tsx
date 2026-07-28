import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { apiConfigured, useApiStatus } from '../../lib/api';
import { colors } from '../../lib/theme';

// Blocking error state when the real API is configured but unreachable.
// Deliberately covers the whole app: screens beneath may have rendered
// mock fallback data, and that must never be mistaken for real data.
export function ApiErrorOverlay() {
  const unreachable = useApiStatus((s) => s.unreachable);
  const setUnreachable = useApiStatus((s) => s.setUnreachable);
  if (!apiConfigured || !unreachable) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="9" stroke={colors.ink} strokeWidth={1.9} />
            <Path d="M12 7.5V13M12 16.4h.01" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </View>
        <Text style={styles.title}>Can't reach the server</Text>
        <Text style={styles.sub}>
          Check your connection and try again. Nothing you see should be trusted until we're back —
          we don't show stale or placeholder data.
        </Text>
        <Pressable onPress={() => setUnreachable(false)} style={styles.cta}>
          <Text style={styles.ctaLabel}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26,26,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 1000,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.offWhite,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
  },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 13, color: colors.grey, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  cta: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 15,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
