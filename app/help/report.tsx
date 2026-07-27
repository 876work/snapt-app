import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { InfoBanner } from '../../components/ui/Misc';
import { useBookings, creatorById } from '../../lib/store';
import { colors, spacing } from '../../lib/theme';

// Dispute intake must tie to a specific booking, not free text only (§10).
export default function ReportProblem() {
  const router = useRouter();
  const bookings = useBookings((s) => s.bookings);
  const [bookingId, setBookingId] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState('');

  return (
    <View style={styles.root}>
      <ScreenHeader title="Report a problem" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>Which booking is this about?</Text>
        <View style={{ gap: 8 }}>
          {bookings.map((b) => {
            const c = creatorById(b.creatorId);
            const active = bookingId === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() => setBookingId(b.id)}
                style={[styles.bkRow, active && styles.bkRowActive]}
              >
                <Text style={styles.bkLabel}>
                  {b.occasion}
                  {c ? ` with ${c.name}` : ''} ·{' '}
                  {new Date(b.scheduledAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ marginTop: 18 }}>
          <TextField
            label="What happened?"
            value={details}
            onChangeText={setDetails}
            multiline
            style={{ height: 120, paddingTop: 14, textAlignVertical: 'top' }}
          />
        </View>
        <View style={{ marginTop: 14 }}>
          <InfoBanner text="Reports open a structured dispute tied to your booking. You'll have 72 hours to add evidence once it's opened." />
        </View>
        <Button
          title="Submit report"
          disabled={!bookingId || !details}
          onPress={() => router.back()}
          style={{ marginTop: 18 }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  sectionLabel: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginBottom: 12 },
  bkRow: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  bkRowActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  bkLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
});
