import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors } from '../../lib/theme';

export default function Forgot() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  return (
    <View style={styles.root}>
      <ScreenHeader title="Reset your password" />
      <View style={styles.body}>
        <Text style={styles.sub}>
          Enter the email on your account and we'll send you a reset code.
        </Text>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Button
          title="Send code"
          arrow
          disabled={!email.includes('@')}
          onPress={() => router.push({ pathname: '/(auth)/forgot-code', params: { email } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 16 },
  sub: { fontSize: 13.5, lineHeight: 19.5, color: colors.grey },
});
