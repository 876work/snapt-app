import React from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Text } from '../../lib/text';
import Svg, { Path } from 'react-native-svg';
import { safeBack } from '../../lib/nav';
import { colors, spacing } from '../../lib/theme';

/**
 * Where `?from=` sends an empty-stack back. The notifications list and the
 * push-tap handler stamp this on the routes they open, so back returns the
 * user where they actually came from instead of safeBack's generic home
 * default — which is what dropped people on Home after tapping a push.
 *
 * Carried as a ROUTE PARAM, not module state: it lives and dies with the
 * screen it describes, so it can never go stale and hijack an unrelated
 * back later.
 */
const FROM_ROUTE: Record<string, string> = {
  inbox: '/(app)/inbox',
};

export function ScreenHeader({
  title,
  onBack,
  right,
  backFallback,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  /** Where back lands when there is no history to pop (default: home). */
  backFallback?: string;
}) {
  const { from } = useLocalSearchParams<{ from?: string }>();
  // The arrival route is more specific than any static default, so it wins.
  const fallback = (from && FROM_ROUTE[String(from)]) || backFallback;
  return (
    // Tapping the header dismisses an open keyboard (blank areas inside the
    // scroll body already do). Returning false means the touch still reaches
    // the back button and any right-hand action.
    <View
      style={styles.row}
      onStartShouldSetResponder={() => {
        Keyboard.dismiss();
        return false;
      }}
    >
      <Pressable
        onPress={onBack ?? (() => safeBack(fallback))}
        style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}
      >
        <Svg width={10} height={17} viewBox="0 0 10 17" fill="none">
          <Path
            d="M8.5 1.5L2 8.5l6.5 7"
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingTop: spacing.headerTop,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, flex: 1 },
});
