import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { colors } from '../../lib/theme';

export default function Welcome() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Image
          source={require('../../assets/design/snapt-icon.png')}
          style={{ width: 130, height: 154 }}
          resizeMode="contain"
        />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Your moment,{'\n'}captured.</Text>
        <Text style={styles.sub}>
          Book a vetted photographer or videographer in minutes — or send us footage you already
          have and let a Snapt editor take it from there.
        </Text>
        <Button title="Get started" arrow onPress={() => router.push('/(auth)/intro')} />
        <Button
          title="I already have an account"
          variant="ghost"
          onPress={() => router.push('/(auth)/login')}
          style={{ marginTop: 10 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -1, color: colors.ink, marginBottom: 12 },
  sub: { fontSize: 14.5, lineHeight: 21, color: colors.grey, marginBottom: 28 },
});
