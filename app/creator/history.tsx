import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../lib/store';
import { formatMoney } from '../../lib/constants/business';
import { creatorPayUsd } from '../../lib/creatorJobs';
import { colors, insetBottom } from '../../lib/theme';

/**
 * HISTORY — completed and cancelled work.
 *
 * Split out of the work queue deliberately. Finished jobs were mixed into
 * the same offers array as live ones, so the two things a creator has to act
 * on today sat among everything they had ever done. Past work is a lookup —
 * "what did that wedding pay?" — not a daily need, so it gets its own screen
 * reached from Schedule rather than a place in the queue.
 *
 * Reads the server directly. Three states, creators.tsx-style: a failed
 * fetch says so instead of rendering as "no past jobs".
 */
interface PastJob {
  id: string;
  title: string;
  when: string;
  payUsd: number;
  status: string;
}

export default function CreatorHistory() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const [jobs, setJobs] = React.useState<PastJob[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const { apiConfigured, fetchMyBookings } = await import('../../lib/api');
    if (!apiConfigured) {
      setLoading(false);
      setFailed(true);
      return;
    }
    const rows = await fetchMyBookings();
    if (!rows) {
      setLoading(false);
      setFailed(true);
      return;
    }
    const { useAuth: authStore } = await import('../../lib/store');
    const me = authStore.getState().userId;
    const past = rows
      .filter((b) => b.creator_id === me && ['completed', 'cancelled', 'no_show'].includes(b.status))
      .sort((a, b) => (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? ''))
      .map((b) => ({
        id: b.id,
        title: b.occasion ? `${b.occasion} session` : 'Remote edit order',
        when: b.scheduled_at
          ? new Date(b.scheduled_at).toLocaleDateString(undefined, {
              weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
            })
          : 'Remote order',
        // Same server-computed figure the job card shows — see creatorPayUsd.
        payUsd: creatorPayUsd(b),
        status: b.status,
      }));
    setJobs(past);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.root}>
      <ScreenHeader title="History" />
      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.yellowDark} />
          <Text style={styles.stateSub}>Loading your past work…</Text>
        </View>
      ) : failed ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>Couldn't load your history</Text>
          <Text style={styles.stateSub}>
            Check your connection — your completed jobs and earnings are safe.
          </Text>
          <Button title="Try again" onPress={load} />
        </View>
      ) : (jobs ?? []).length === 0 ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>No completed jobs yet</Text>
          <Text style={styles.stateSub}>
            Finished sessions and delivered edits appear here, with what each one paid.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {jobs!.map((j) => (
            <Pressable
              key={j.id}
              onPress={() => router.push(`/creator/job/${j.id}`)}
              style={styles.card}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle}>{j.title}</Text>
                <Text style={styles.cardMeta}>
                  {j.when}
                  {j.status !== 'completed' ? ` · ${j.status.replace('_', ' ')}` : ''}
                </Text>
              </View>
              {j.status === 'completed' && (
                <Text style={styles.pay}>{formatMoney(j.payUsd, currency)}</Text>
              )}
            </Pressable>
          ))}
          <View style={{ height: insetBottom + 90 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 10 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  stateSub: { fontSize: 13.5, color: colors.grey, textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 15,
    marginBottom: 10,
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  cardMeta: { fontSize: 12, color: colors.grey, marginTop: 3 },
  pay: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
});
