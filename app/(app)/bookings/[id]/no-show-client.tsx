import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../../../components/ui/SlideToConfirm';
import { Card, InfoBanner } from '../../../../components/ui/Misc';
import { useBookings } from '../../../../lib/store';
import { apiConfigured, reportNoShowApi } from '../../../../lib/api';
import { NO_SHOW_GRACE_MINUTES } from '../../../../lib/constants/business';
import { colors, spacing } from '../../../../lib/theme';

// Client reports a creator no-show. Grace period countdown gates the report;
// slide-to-confirm is required (financial consequence) — handoff §8.
export default function NoShowClient() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, reportNoShow } = useBookings();
  const booking = bookings.find((b) => b.id === id);

  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!booking) return null;

  const graceEnd = new Date(booking.scheduledAt).getTime() + NO_SHOW_GRACE_MINUTES * 60_000;
  const remainingMs = graceEnd - now;
  const graceOver = remainingMs <= 0;
  const mins = Math.max(0, Math.floor(remainingMs / 60_000));
  const secs = Math.max(0, Math.floor((remainingMs % 60_000) / 1000));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Creator hasn't arrived?" />
      <ScrollView contentContainerStyle={styles.body}>
        {!graceOver ? (
          <>
            <Card style={styles.countdownCard}>
              <Text style={styles.countdownLabel}>Grace period ends in</Text>
              <Text style={styles.countdown}>
                {mins}:{secs.toString().padStart(2, '0')}
              </Text>
              <Text style={styles.countdownSub}>
                Creators get a {NO_SHOW_GRACE_MINUTES}-minute window past the scheduled start.
                Reporting unlocks when it ends.
              </Text>
            </Card>
            <View style={{ marginTop: 14 }}>
              <InfoBanner text="In the meantime — try messaging your creator. Most late arrivals are traffic or parking." />
            </View>
          </>
        ) : (
          <>
            <InfoBanner
              tone="error"
              text="The grace period has passed. If your creator still hasn't arrived, you can file a no-show report. You'll receive a full refund, and we'll offer a rematch or free cancellation."
            />
            <View style={{ marginTop: 26 }}>
              <SlideToConfirm
                label="Slide to report no-show"
                danger
                onConfirm={async () => {
                  // Server re-checks the grace period and issues the full
                  // refund + creator strike (§8).
                  if (apiConfigured) await reportNoShowApi(booking.id);
                  reportNoShow(booking.id);
                  router.replace(`/bookings/${booking.id}/no-show-client-done`);
                }}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  countdownCard: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  countdownLabel: { fontSize: 12.5, fontWeight: '700', color: colors.grey },
  countdown: { fontSize: 44, fontWeight: '800', letterSpacing: -1, color: colors.ink },
  countdownSub: { fontSize: 12, color: colors.grey, textAlign: 'center', lineHeight: 17, paddingHorizontal: 12 },
});
