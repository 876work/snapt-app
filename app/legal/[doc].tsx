import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { InfoBanner } from '../../components/ui/Misc';
import { colors, spacing } from '../../lib/theme';
import { LEGAL_DOCS } from './index';

export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const meta = LEGAL_DOCS.find((d) => d.slug === doc);

  return (
    <View style={styles.root}>
      <ScreenHeader title={meta?.title ?? 'Policy'} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.updated}>Last updated: [Insert date]</Text>
        <InfoBanner text="Draft placeholder — the published version of this document is served from the policy content system after attorney review (versioned, with re-consent on material changes where required)." />
        <Text style={styles.placeholder}>
          The full text of the {meta?.title ?? 'policy'} will appear here.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40, gap: 14 },
  updated: { fontSize: 12, color: colors.greyLight, fontWeight: '600' },
  placeholder: { fontSize: 13.5, lineHeight: 20, color: colors.grey },
});
