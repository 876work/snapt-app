import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Divider } from '../../components/ui/Misc';
import { colors } from '../../lib/theme';

export default function Signup() {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const canContinue = name.trim().length > 0 && email.includes('@') && password.length >= 8;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Create your account" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextField label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="At least 8 characters"
        />
        <Button
          title="Continue"
          arrow
          disabled={!canContinue}
          onPress={() =>
            router.push({ pathname: '/(auth)/verify', params: { name, email } })
          }
        />
        <Divider label="or continue with" />
        <View style={styles.oauthRow}>
          {['Google', 'Apple', 'Facebook'].map((p) => (
            <View key={p} style={styles.oauthBtn}>
              <Text style={styles.oauthLabel}>{p}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.legal}>
          By continuing you agree to Snapt's Terms of Service and Privacy Policy.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 40, gap: 16 },
  oauthRow: { flexDirection: 'row', gap: 10 },
  oauthBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  oauthLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  legal: { fontSize: 11.5, color: colors.greyLight, textAlign: 'center', lineHeight: 16 },
});
