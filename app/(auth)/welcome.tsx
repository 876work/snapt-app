import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { LogoTile } from '../../components/auth/AuthBits';
import { insetBottom, insetTop } from '../../lib/theme';

// CD design: dark hero — logo tile, wordmark, yellow tagline, blurb, then
// yellow Sign up + outlined Log in pinned to the bottom. Sign up runs
// through the onboarding slides (intro) which end at the signup form.
export default function Welcome() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <LogoTile size={86} />
        <Text style={styles.wordmark}>Snapt</Text>
        <Text style={styles.tagline}>Be in the moment.{'\n'}We've got the rest.</Text>
        <Text style={styles.blurb}>
          Book trusted local creators for weddings,{'\n'}birthdays, parties, brand events and more
        </Text>
      </View>
      <View style={styles.footer}>
        <Pressable onPress={() => router.push('/(auth)/intro')} style={styles.signup}>
          <Text style={styles.signupLabel}>Sign up</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/(auth)/login')} style={styles.login}>
          <Text style={styles.loginLabel}>Log in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#191919', paddingTop: insetTop },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, marginTop: -30 },
  wordmark: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.8, marginTop: 22 },
  tagline: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFB800',
    textAlign: 'center',
    lineHeight: 27,
    marginTop: 12,
    letterSpacing: -0.3,
  },
  blurb: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 26,
  },
  footer: { paddingHorizontal: 22, paddingBottom: Math.max(insetBottom + 12, 30), gap: 12 },
  signup: {
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFB800',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signupLabel: { fontSize: 16, fontWeight: '800', color: '#1A1A1A' },
  login: {
    height: 54,
    borderRadius: 27,
    backgroundColor: 'transparent',
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginLabel: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
