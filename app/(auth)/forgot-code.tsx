import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CodeInput } from '../../components/ui/CodeInput';
import { colors } from '../../lib/theme';

export default function ForgotCode() {
  const router = useRouter();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = React.useState('');
  return (
    <View style={styles.root}>
      <ScreenHeader title="Enter your code" />
      <View style={styles.body}>
        <Text style={styles.sub}>
          We sent a 4-digit code to{' '}
          <Text style={{ fontWeight: '800', color: colors.ink }}>{email}</Text>.
        </Text>
        <CodeInput value={code} onChange={setCode} />
        <Button
          title="Continue"
          arrow
          disabled={code.length < 4}
          onPress={() => router.push('/(auth)/forgot-reset')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 24 },
  sub: { fontSize: 13.5, lineHeight: 19.5, color: colors.grey },
});
