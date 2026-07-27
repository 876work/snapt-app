import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { InfoBanner } from '../../components/ui/Misc';
import { colors, spacing } from '../../lib/theme';
import { LEGAL_DOCS } from '../../lib/mock/legal';

// Served from the versioned policy CMS (§14): latest PUBLISHED version with
// its real "Last updated" date. Placeholder shown in mock mode or when no
// version has been published yet (e.g. Terms/Privacy pending source docs).
export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const meta = LEGAL_DOCS.find((d) => d.slug === doc);
  const [policy, setPolicy] = React.useState<{ content: string; published_at: string; version: number } | null>(null);
  React.useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
    if (!apiUrl || !doc) return;
    fetch(`${apiUrl}/v1/policies/${doc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.policy && setPolicy(j.policy))
      .catch(() => {});
  }, [doc]);

  return (
    <View style={styles.root}>
      <ScreenHeader title={meta?.title ?? 'Policy'} />
      <ScrollView contentContainerStyle={styles.body}>
        {policy ? (
          <>
            <Text style={styles.updated}>
              Last updated: {new Date(policy.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · v{policy.version}
            </Text>
            <Text style={styles.content}>{policy.content}</Text>
          </>
        ) : (
          <>
            <Text style={styles.updated}>Last updated: —</Text>
            <InfoBanner text="No published version of this document is available yet — the final text arrives after attorney review." />
            <Text style={styles.content}>The full text of the {meta?.title ?? 'policy'} will appear here.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40, gap: 14 },
  updated: { fontSize: 12, color: colors.greyLight, fontWeight: '600' },
  content: { fontSize: 13.5, lineHeight: 20, color: colors.grey },
});
