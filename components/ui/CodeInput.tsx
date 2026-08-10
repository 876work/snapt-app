import React from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
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
  onComplete,
  focusRef,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  /**
   * Fired once the code is complete, so nobody has to reach for a button
   * they can already see the answer to. Lives HERE rather than in each
   * screen: two copies of a fire-once guard is two chances to get it wrong.
   */
  onComplete?: (code: string) => void;
  /** Lets a screen pull focus back to the first box after a failure. */
  focusRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const ref = React.useRef<TextInput>(null);

  /**
   * ONE SUBMISSION PER DISTINCT CODE.
   *
   * Keyed on the code string, not a boolean: deleting a digit and retyping
   * the SAME six must not fire twice, but correcting a typo to a genuinely
   * different code must. Cleared only when the value changes to something
   * that isn't what we last submitted — a failure deliberately leaves the
   * guard armed, so a wrong code cannot auto-resubmit itself.
   *
   * The guard matters even with GoTrue's 30-per-5-minutes headroom, because
   * that budget is per IP: a shared connection splits it between everyone
   * on it.
   */
  const submitted = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (focusRef) focusRef.current = () => ref.current?.focus();
  }, [focusRef]);

  React.useEffect(() => {
    if (value.length !== length) return;
    if (submitted.current === value) return;
    submitted.current = value;
    // A brief beat so the last digit visibly lands before the screen moves —
    // otherwise the tap appears to do nothing and the screen just changes.
    const t = setTimeout(() => {
      Keyboard.dismiss();
      onComplete?.(value);
    }, 300);
    return () => clearTimeout(t);
    // onComplete is intentionally excluded: an inline arrow from the parent
    // is a new reference every render and would re-fire the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, length]);

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
        onChangeText={(t) => {
          // Completeness is judged on the VALUE, never a keystroke count:
          // autofill delivers all six in a single change and would skip a
          // per-keystroke trigger entirely.
          const next = t.replace(/\D/g, '').slice(0, length);
          if (submitted.current !== null && next !== submitted.current) {
            submitted.current = null; // a genuinely different code may fire
          }
          onChange(next);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
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
