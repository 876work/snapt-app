import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useAuth } from '../../lib/store';
import { Currency, getXcdPerUsd } from '../../lib/constants/business';
import { colors } from '../../lib/theme';

// Built per-render so the peg reflects the server-synced rate, not the
// bundled fallback captured at import time.
const options = (): { value: Currency; title: string; sub: string }[] => [
  { value: 'USD', title: 'US Dollar (USD)', sub: 'Base currency — all charges settle in USD' },
  {
    value: 'XCD',
    title: 'EC Dollar (XCD)',
    sub: `Approximate display prices at the fixed peg ${getXcdPerUsd()} XCD = 1 USD — charges are always processed in USD`,
  },
];

export default function OnboardingCurrency() {
  const router = useRouter();
  const { name = '', email = '' } = useLocalSearchParams<{ name?: string; email?: string }>();
  const setCurrency = useAuth((s) => s.setCurrency);
  const [choice, setChoice] = React.useState<Currency>('USD');

  return (
    <View style={styles.root}>
      <ScreenHeader title="How should we show prices?" />
      <View style={styles.body}>
        <Text style={styles.sub}>You can change this any time in your Profile.</Text>
        {options().map((o) => {
          const active = o.value === choice;
          return (
            <Pressable
              key={o.value}
              onPress={() => setChoice(o.value)}
              style={[styles.option, active && styles.optionActive]}
            >
              <View style={[styles.radio, active && styles.radioActive]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{o.title}</Text>
                <Text style={styles.optionSub}>{o.sub}</Text>
              </View>
            </Pressable>
          );
        })}
        <Button
          title="Continue"
          arrow
          onPress={() => {
            setCurrency(choice);
            router.push({ pathname: '/(auth)/push-prime', params: { name, email } });
          }}
          style={{ marginTop: 8 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 12 },
  sub: { fontSize: 13.5, color: colors.grey, marginBottom: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
  },
  optionActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.greyLight,
  },
  radioActive: { borderWidth: 6, borderColor: colors.yellow },
  optionTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  optionSub: { fontSize: 12, color: colors.grey, marginTop: 3, lineHeight: 16.5 },
});
