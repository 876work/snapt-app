import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors } from '../../lib/theme';

export default function ForgotReset() {
  const router = useRouter();
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const ok = pw.length >= 8 && pw === pw2;
  return (
    <View style={styles.root}>
      <ScreenHeader title="Choose a new password" />
      <View style={styles.body}>
        <TextField
          label="New password"
          value={pw}
          onChangeText={setPw}
          secureTextEntry
          placeholder="At least 8 characters"
        />
        <TextField label="Confirm password" value={pw2} onChangeText={setPw2} secureTextEntry />
        {pw2.length > 0 && pw !== pw2 && (
          <Text style={styles.err}>Passwords don't match yet.</Text>
        )}
        <Button
          title="Reset password"
          arrow
          disabled={!ok}
          onPress={() => router.dismissTo('/(auth)/login')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, gap: 16 },
  err: { fontSize: 12.5, color: colors.error, fontWeight: '600' },
});
