import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';

// Cells flex to the available row width (capped at the design's 58pt) so
// 6-digit codes fit every device — fixed 58pt cells overflowed the screen
// once real GoTrue codes (6 digits) replaced the 4-digit mock. The hidden
// input stays the raw RN TextInput: it renders no glyphs and needs a ref.
export function CodeInput({
  length = 4,
  value,
  onChange,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = React.useRef<TextInput>(null);
  return (
    <Pressable onPress={() => ref.current?.focus()}>
      <View style={styles.row}>
        {Array.from({ length }).map((_, i) => (
          <View key={i} style={[styles.cell, i === value.length && styles.cellActive]}>
            <Text style={styles.digit}>{value[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        style={styles.hidden}
        autoFocus
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  cell: {
    flex: 1,
    maxWidth: 58,
    height: 64,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: colors.yellow },
  digit: { fontSize: 24, fontWeight: '800', color: colors.ink },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
