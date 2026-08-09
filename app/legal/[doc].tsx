import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
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
  // Three states (creators.tsx rule). A network failure used to render the
  // "no published version yet" fallback — telling someone the Terms they
  // just agreed to don't exist. Only an explicit 404 means unpublished;
  // everything else is a load failure with a retry.
  const [phase, setPhase] = React.useState<'loading' | 'ready' | 'unpublished' | 'failed'>('loading');
  const [reloadKey, setReloadKey] = React.useState(0);
  React.useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
    if (!apiUrl || !doc) {
      setPhase('unpublished'); // mock mode: previous fallback copy
      return;
    }
    setPhase('loading');
    fetch(`${apiUrl}/v1/policies/${doc}`)
      .then(async (r) => {
        if (r.status === 404) return setPhase('unpublished');
        if (!r.ok) return setPhase('failed');
        const j = (await r.json()) as { policy?: { content: string; published_at: string; version: number } };
        if (j?.policy) {
          setPolicy(j.policy);
          setPhase('ready');
        } else {
          setPhase('unpublished');
        }
      })
      .catch(() => setPhase('failed'));
  }, [doc, reloadKey]);

  return (
    <View style={styles.root}>
      <ScreenHeader title={meta?.title ?? 'Policy'} />
      <ScrollView contentContainerStyle={styles.body}>
        {phase === 'ready' && policy ? (
          <>
            <Text style={styles.updated}>
              Last updated: {new Date(policy.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · v{policy.version}
            </Text>
            <Text style={styles.content}>{policy.content}</Text>
          </>
        ) : phase === 'loading' ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        ) : phase === 'failed' ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateTitle}>Couldn't load this document</Text>
            <Text style={styles.stateBody}>
              It exists — this is a connection problem. Check your connection and try again.
            </Text>
            <Pressable onPress={() => setReloadKey((k) => k + 1)} style={styles.stateRetry}>
              <Text style={styles.stateRetryLabel}>Try again</Text>
            </Pressable>
          </View>
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
  stateWrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 26, gap: 6 },
  stateTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateBody: { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19 },
  stateRetry: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.yellow },
  stateRetryLabel: { fontSize: 14, color: colors.ink },
});
