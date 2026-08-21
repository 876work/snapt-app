import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { colors, spacing } from '../lib/theme';
import Constants from 'expo-constants';

export default function About() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScreenHeader title="About" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center' }}>
          <View style={styles.iconWrap}>
            <Image
              source={require('../assets/design/snapt-mark.webp')}
              style={{ width: 46, height: 46 }}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.name}>Snapt</Text>
          {/* expoConfig.version — the same source the Build & updates panel
              uses (the native version constants are deprecated nulls in
              SDK 57). This was a hardcoded "0.1.0" while the panel one
              screen away printed the real 1.0.0. */}
          <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '?'}</Text>
          <Text style={styles.blurb}>
            On-demand creators and editing, wherever the moment happens. Be in the moment — we've got
            the rest.
          </Text>
        </View>
        <View style={styles.list}>
          <Pressable onPress={() => router.push('/legal/terms')} style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>Terms & Conditions</Text>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
          <Pressable onPress={() => router.push('/legal/privacy')} style={styles.row}>
            <Text style={styles.rowLabel}>Privacy Policy</Text>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        </View>
        <Text style={styles.copyright}>© 2026 Snapt Inc. · Made with care in the Caribbean</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, alignItems: 'stretch' },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#F0EDE6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  name: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, marginTop: 16 },
  version: { fontSize: 13, color: colors.grey, marginTop: 4 },
  blurb: {
    fontSize: 13.5,
    color: '#5C574E',
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 16,
    maxWidth: 280,
    alignSelf: 'center',
  },
  list: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 26,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 18 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F1F1' },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  copyright: { fontSize: 11.5, color: '#9A948B', marginTop: 26, textAlign: 'center' },
});
