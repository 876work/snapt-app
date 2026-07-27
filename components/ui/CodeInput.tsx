import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../lib/theme';

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
  row: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  cell: {
    width: 58,
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
