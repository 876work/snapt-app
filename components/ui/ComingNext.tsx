import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { ScreenHeader } from './ScreenHeader';
import { colors } from '../../lib/theme';
import { BoltIcon } from './Icons';

export function ComingNext({ title, note }: { title: string; note: string }) {
  return (
    <View style={styles.root}>
      <ScreenHeader title={title} />
      <View style={styles.center}>
        <View style={styles.badge}>
          <BoltIcon size={30} />
        </View>
        <Text style={styles.title}>Coming next</Text>
        <Text style={styles.note}>{note}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12, marginTop: -80 },
  badge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  note: { fontSize: 13, lineHeight: 19, color: colors.grey, textAlign: 'center' },
});
