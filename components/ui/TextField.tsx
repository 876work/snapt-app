import React from 'react';
import { StyleSheet, TextInputProps, View } from 'react-native';
import { Text, TextInput } from '../../lib/text';
import { colors } from '../../lib/theme';

interface Props extends TextInputProps {
  label?: string;
}

/**
 * Shared labelled input. Forwards its ref so multi-field forms can chain
 * focus: `returnKeyType="next"` + `onSubmitEditing={() => next.current?.focus()}`
 * walks the form from the keyboard; the app-wide keyboard shell keeps the
 * focused field visible.
 */
export const TextField = React.forwardRef<React.ComponentRef<typeof TextInput>, Props>(
  function TextField({ label, style, ...rest }, ref) {
    return (
      <View style={{ gap: 7 }}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor="#9A9A9A"
          style={[styles.input, style]}
          {...rest}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  label: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 14,
    color: colors.ink,
  },
});
