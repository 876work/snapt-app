import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card, InfoBanner } from '../../components/ui/Misc';
import { colors, spacing } from '../../lib/theme';

import { LEGAL_DOCS } from '../../lib/mock/legal';

export default function Legal() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScreenHeader title="Legal" />
      <ScrollView contentContainerStyle={styles.body}>
        <InfoBanner text="These documents are working drafts pending attorney review." />
        <Card style={{ paddingVertical: 4, paddingHorizontal: 0, marginTop: 14 }}>
          {LEGAL_DOCS.map((d, i) => (
            <Pressable
              key={d.slug}
              onPress={() => router.push(`/legal/${d.slug}`)}
              style={[styles.row, i < LEGAL_DOCS.length - 1 && styles.rowBorder]}
            >
              <Text style={styles.rowLabel}>{d.title}</Text>
              <Svg width={8} height={14} viewBox="0 0 8 14">
                <Path
                  d="M1 1l6 6-6 6"
                  stroke={colors.greyLight}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          ))}
        </Card>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
});
