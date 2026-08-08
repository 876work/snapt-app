import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from '../../lib/text';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../lib/theme';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'dark' | 'ghost' | 'danger';
  arrow?: boolean;
  disabled?: boolean;
  /**
   * In-flight: spinner, and taps ignored so a slow call cannot be fired
   * twice. Checkout needs this — a cold Render dyno takes 30-60s to answer
   * and the screen otherwise looks dead, which is exactly what people
   * respond to by tapping again (and creating a second PaymentIntent).
   */
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', arrow, disabled, loading, style }: Props) {
  const inert = disabled || loading;
  const bg =
    variant === 'primary'
      ? colors.yellow
      : variant === 'dark'
        ? colors.ink
        : variant === 'danger'
          ? colors.error
          : 'transparent';
  const fg = variant === 'dark' || variant === 'danger' ? '#fff' : colors.ink;
  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: disabled ? 0.4 : loading ? 0.75 : pressed ? 0.85 : 1 },
        variant === 'primary' && styles.primaryShadow,
        variant === 'ghost' && styles.ghost,
        style,
      ]}
    >
      {loading && <ActivityIndicator size="small" color={fg} />}
      <Text style={[styles.label, { color: fg }]}>{title}</Text>
      {arrow && !loading && (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12h14M13 6l6 6-6 6"
            stroke={fg}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryShadow: {
    shadowColor: colors.yellow,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ghost: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  label: { fontSize: 16, fontWeight: '700' },
});
