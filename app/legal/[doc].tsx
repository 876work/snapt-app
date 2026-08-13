import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { InfoBanner } from '../../components/ui/Misc';
import { colors, spacing } from '../../lib/theme';
import { LEGAL_DOCS, RETIRED_TITLES, resolveLegalSlug } from '../../lib/mock/legal';

// Served from the versioned policy CMS (§14): latest PUBLISHED version with
// its real "Last updated" date. Placeholder shown in mock mode or when no
// version has been published yet (e.g. Terms/Privacy pending source docs).
export default function LegalDoc() {
  const { doc, section } = useLocalSearchParams<{ doc: string; section?: string }>();
  /**
   * A retired slug resolves to the document that absorbed it rather than
   * 404ing. Old links live in sent emails, screenshots and anyone's browser
   * history, and the nine consolidated policies were all reachable by name
   * until today.
   */
  const requested = doc ?? '';
  const slug = resolveLegalSlug(requested);
  const redirectedFrom = slug !== requested ? RETIRED_TITLES[requested] : null;
  const meta = LEGAL_DOCS.find((d) => d.slug === slug);
  const [policy, setPolicy] = React.useState<{ content: string; published_at: string; version: number } | null>(null);
  // Three states (creators.tsx rule). A network failure used to render the
  // "no published version yet" fallback — telling someone the Terms they
  // just agreed to don't exist. Only an explicit 404 means unpublished;
  // everything else is a load failure with a retry.
  const [phase, setPhase] = React.useState<'loading' | 'ready' | 'unpublished' | 'failed'>('loading');
  const [reloadKey, setReloadKey] = React.useState(0);
  React.useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
    if (!apiUrl || !slug) {
      setPhase('unpublished'); // mock mode: previous fallback copy
      return;
    }
    setPhase('loading');
    fetch(`${apiUrl}/v1/policies/${slug}`)
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
  }, [slug, reloadKey]);

  /**
   * Consolidated documents are long, and the creator application links
   * straight at the Background Check part. Splitting on the PART rule lets a
   * chunk be measured and scrolled to; without it the link lands at the top
   * of nineteen thousand characters, which is the same as not linking.
   */
  const chunks = React.useMemo(() => {
    const text = policy?.content ?? '';
    if (!text) return [] as { key: string; text: string }[];
    const parts = text.split(/\n(?=─{10,}\nPART: )/);
    return parts.map((t, i) => {
      const heading = /^─{10,}\nPART: (.+)$/m.exec(t)?.[1] ?? '';
      return { key: heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `part-${i}`, text: t };
    });
  }, [policy?.content]);

  const scrollRef = React.useRef<ScrollView>(null);
  const offsets = React.useRef<Record<string, number>>({});
  const jumped = React.useRef(false);
  React.useEffect(() => {
    jumped.current = false;
  }, [slug, section]);
  const maybeJump = React.useCallback(() => {
    if (jumped.current || !section) return;
    // startsWith: 'background-check' should find 'background-check-vetting-disclosure'.
    const hit = Object.keys(offsets.current).find((k) => k.startsWith(section));
    if (hit == null) return;
    jumped.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(0, offsets.current[hit] - 12), animated: true });
  }, [section]);

  return (
    <View style={styles.root}>
      <ScreenHeader title={meta?.title ?? 'Policy'} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
        {redirectedFrom && (
          /* A silent swap from "Payment & Payout Policy" to "Creator
             Agreement" reads as a broken link. Say what happened. */
          <InfoBanner
            text={`The ${redirectedFrom} is now part of the ${meta?.title ?? 'this document'}. You're reading the consolidated version.`}
          />
        )}
        {phase === 'ready' && policy ? (
          <>
            <Text style={styles.updated}>
              Last updated: {new Date(policy.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · v{policy.version}
            </Text>
            {chunks.length > 1 ? (
              chunks.map((c) => (
                <View
                  key={c.key}
                  onLayout={(e) => {
                    offsets.current[c.key] = e.nativeEvent.layout.y;
                    maybeJump();
                  }}
                >
                  <Text style={styles.content}>{c.text}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.content}>{policy.content}</Text>
            )}
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
