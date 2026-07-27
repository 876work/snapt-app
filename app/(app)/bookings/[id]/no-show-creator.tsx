import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../../../components/ui/SlideToConfirm';
import { Card, InfoBanner } from '../../../../components/ui/Misc';
import { useBookings } from '../../../../lib/store';
import { apiConfigured, reportNoShowApi } from '../../../../lib/api';
import { NO_SHOW_GRACE_MINUTES } from '../../../../lib/constants/business';
import { colors, spacing } from '../../../../lib/theme';

// Creator reports a client no-show. Requires an attempted-contact
// confirmation step before the report can be filed (§8). Client is charged
// in full; creator receives standard payout.
export default function NoShowCreator() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, reportNoShow } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const [contacted, setContacted] = React.useState(false);

  if (!booking) return null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Client hasn't arrived?" />
      <ScrollView contentContainerStyle={styles.body}>
        <InfoBanner
          text={`Clients get a ${NO_SHOW_GRACE_MINUTES}-minute grace window. Once it's passed and you've tried to reach them, you can file a no-show report — you'll still receive your standard payout.`}
        />
        <Card style={{ marginTop: 14, gap: 12 }}>
          <Text style={styles.stepTitle}>Before you file</Text>
          <Pressable onPress={() => setContacted(!contacted)} style={styles.checkRow}>
            <View style={[styles.checkbox, contacted && styles.checkboxOn]}>
              {contacted && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>
              I've tried to contact the client through chat and waited the full grace period.
            </Text>
          </Pressable>
        </Card>
        {contacted ? (
          <View style={{ marginTop: 26 }}>
            <SlideToConfirm
              label="Slide to report no-show"
              danger
              onConfirm={async () => {
                // attempted_contact is required server-side before a
                // creator-filed report is accepted (§8).
                if (apiConfigured) await reportNoShowApi(booking.id, true);
                reportNoShow(booking.id);
                router.dismissTo('/bookings');
              }}
            />
          </View>
        ) : (
          <Text style={styles.hint}>Check the box above to unlock the report.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  stepTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.greyLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  checkmark: { fontSize: 14, fontWeight: '800', color: colors.ink },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 18.5, color: colors.ink, fontWeight: '500' },
  hint: { fontSize: 12, color: colors.grey, textAlign: 'center', marginTop: 12 },
});
