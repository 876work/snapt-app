import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../lib/theme';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'dark' | 'ghost' | 'danger';
  arrow?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', arrow, disabled, style }: Props) {
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
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        variant === 'primary' && styles.primaryShadow,
        variant === 'ghost' && styles.ghost,
        style,
      ]}
    >
      <Text style={[styles.label, { color: fg }]}>{title}</Text>
      {arrow && (
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
