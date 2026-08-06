import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';

/**
 * Police certificate upload — surface built, marked "Coming soon".
 * Never required, never blocks approval. The admin review screen shows the
 * same status so nobody waits on a document we aren't collecting yet.
 */
export function PoliceCertificate() {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
          <Rect x="4.5" y="3" width="15" height="18" rx="2.5" stroke={colors.grey} strokeWidth={1.8} />
          <Path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
        <Text style={styles.title}>Police certificate</Text>
        <View style={styles.soonPill}>
          <Text style={styles.soonLabel}>Coming soon</Text>
        </View>
      </View>
      <Text style={styles.body}>
        We'll ask for a police certificate later on. It isn't needed now and won't hold up your
        application.
      </Text>
      <Pressable disabled style={[styles.upload, { opacity: 0.45 }]}>
        <Text style={styles.uploadLabel}>Upload certificate</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  soonPill: { backgroundColor: colors.yellowSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  soonLabel: { fontSize: 11, fontWeight: '800', color: colors.goldText },
  body: { fontSize: 12.5, color: colors.grey, lineHeight: 18, marginTop: 8 },
  upload: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  uploadLabel: { fontSize: 13, fontWeight: '700', color: colors.grey },
});
