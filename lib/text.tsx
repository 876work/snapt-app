import React from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  TextInputProps,
  TextProps,
  TextStyle,
} from 'react-native';

// Inter everywhere (the design source is 100% Inter; system fonts were
// rendering every screen visibly off). Custom fonts in RN don't respond to
// numeric fontWeight, so these wrappers map the style's fontWeight to the
// matching loaded Inter face and clear fontWeight. All screens import Text/
// TextInput from here — the fonts themselves load in the root layout.

const FAMILY: Record<string, string> = {
  '100': 'Inter_400Regular',
  '200': 'Inter_400Regular',
  '300': 'Inter_400Regular',
  '400': 'Inter_400Regular',
  normal: 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  bold: 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
  '900': 'Inter_800ExtraBold',
};

function inter(style: TextProps['style'] | TextInputProps['style']): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const family = FAMILY[String(flat.fontWeight ?? '400')] ?? 'Inter_400Regular';
  return { fontFamily: family, fontWeight: undefined };
}

export function Text({ style, ...rest }: TextProps) {
  return <RNText {...rest} style={[style, inter(style)]} />;
}

export function TextInput({ style, ...rest }: TextInputProps) {
  return <RNTextInput {...rest} style={[style, inter(style)]} />;
}
