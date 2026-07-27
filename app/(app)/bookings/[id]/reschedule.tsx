import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { Button } from '../../../../components/ui/Button';
import { InfoBanner } from '../../../../components/ui/Misc';
import { useBookings } from '../../../../lib/store';
import {
  ADVANCE_BOOKING_WINDOW_DAYS,
  RESCHEDULE_FREE_COUNT,
} from '../../../../lib/constants/business';
import { colors, spacing } from '../../../../lib/theme';

const TIMES = ['9:00', '10:30', '12:00', '14:00', '15:30', '17:00'];

export default function ReschedulePick() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, rescheduleBooking } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const [date, setDate] = React.useState<string | null>(null);
  const [time, setTime] = React.useState<string | null>(null);

  if (!booking) return null;

  // >1 free reschedule becomes cancel+rebook (§5)
  const usedFree = booking.rescheduleCount >= RESCHEDULE_FREE_COUNT;

  const days = Array.from({ length: ADVANCE_BOOKING_WINDOW_DAYS }, (_, i) => new Date(Date.now() + (i + 1) * 86400_000));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Pick a new time" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {usedFree && (
          <View style={{ marginBottom: 16 }}>
            <InfoBanner
              tone="error"
              text={`You've used your free reschedule for this booking. Additional changes are treated as a cancellation and re-booking, with the standard cancellation fee schedule.`}
            />
          </View>
        )}
        <Text style={styles.sectionLabel}>Pick a day</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -spacing.screenX }}
          contentContainerStyle={{ paddingHorizontal: spacing.screenX, gap: 9 }}
        >
          {days.map((d) => {
            const iso = d.toISOString().slice(0, 10);
            const active = date === iso;
            return (
              <Pressable key={iso} onPress={() => setDate(iso)} style={[styles.day, active && styles.dayActive]}>
                <Text style={[styles.dayDow, active && { color: colors.ink }]}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <Text style={[styles.dayNum, active && { color: colors.ink }]}>{d.getDate()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Pick a time</Text>
        <View style={styles.timeWrap}>
          {TIMES.map((t) => {
            const active = time === t;
            return (
              <Pressable key={t} onPress={() => setTime(t)} style={[styles.time, active && styles.dayActive]}>
                <Text style={[styles.timeLabel, active && { color: colors.ink }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Confirm new time"
          arrow
          disabled={!date || !time}
          onPress={() => {
            rescheduleBooking(booking.id, `${date}T${time}:00`);
            router.dismissTo(`/bookings/${booking.id}`);
          }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  sectionLabel: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginBottom: 12 },
  day: {
    width: 62,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
    alignItems: 'center',
    gap: 4,
  },
  dayActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  dayDow: { fontSize: 11, fontWeight: '700', color: colors.grey },
  dayNum: { fontSize: 17, fontWeight: '800', color: colors.ink },
  timeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  time: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeLabel: { fontSize: 13, fontWeight: '700', color: colors.grey },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
  },
});
