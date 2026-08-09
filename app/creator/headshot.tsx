import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { HeadshotUpload } from '../../components/creator/HeadshotUpload';
import { colors, spacing } from '../../lib/theme';

/**
 * Headshot management for approved creators — the backfill/replace path.
 * Application-time uploads happen inside the apply form; this screen exists
 * so creators approved before the requirement (or after a rejection) have
 * somewhere to fix being a blank tile.
 */
export default function CreatorHeadshot() {
  const [url, setUrl] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<'pending' | 'approved' | 'rejected' | null>(null);
  const [uploaded, setUploaded] = React.useState(false);
  // creators.tsx three-state rule: a failed fetch used to leave a silent
  // blank where the current headshot should be.
  const [loaded, setLoaded] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) {
        setLoaded(true); // mock mode: demo card, unchanged
        return;
      }
      setLoadFailed(false);
      fetchCreatorMe().then((me) => {
        if (!me) {
          setLoadFailed(true);
          return;
        }
        setUrl(me.headshot_url ?? null);
        setStatus(me.headshot_status ?? null);
        setLoaded(true);
      });
    });
  }, [reloadKey]);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your headshot" backFallback="/creator" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          This is the photo clients see on your card, in matching, and in messages. It goes live
          after a quick review.
        </Text>
        {loadFailed ? (
          <View style={[styles.card, styles.stateCard]}>
            <Text style={styles.stateTitle}>Couldn't load your headshot</Text>
            <Text style={styles.stateBody}>Check your connection and try again.</Text>
            <Pressable onPress={() => setReloadKey((k) => k + 1)} style={styles.stateRetry}>
              <Text style={styles.stateRetryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : !loaded ? (
          <View style={[styles.card, styles.stateCard]}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        ) : (
          <View style={styles.card}>
            <HeadshotUpload
              currentUrl={url}
              status={uploaded ? 'pending' : status}
              onUploaded={() => setUploaded(true)}
            />
          </View>
        )}
        {uploaded && (
          <Text style={styles.note}>
            Uploaded — it's in review now and replaces your current photo once approved. Nothing
            else to do.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  lead: { fontSize: 13.5, color: colors.grey, lineHeight: 20, marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 15,
  },
  note: { fontSize: 12.5, fontWeight: '700', color: '#1E7A45', marginTop: 14, textAlign: 'center' },
  stateCard: { alignItems: 'center', paddingVertical: 30, gap: 6 },
  stateTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateBody: { fontSize: 12.5, color: colors.grey, textAlign: 'center', lineHeight: 18 },
  stateRetry: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.yellow },
  stateRetryLabel: { fontSize: 13, color: colors.ink },
});
