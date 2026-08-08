import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { Button } from '../../../../components/ui/Button';
import { InfoBanner } from '../../../../components/ui/Misc';
import { MonthCalendar } from '../../../../components/ui/MonthCalendar';
import { SlideToConfirm } from '../../../../components/ui/SlideToConfirm';
import { hoursUntil, useAuth, useBookings } from '../../../../lib/store';
import { apiConfigured, fetchDayFlags, fetchDaySlots, rescheduleBookingApi } from '../../../../lib/api';
import {
  ADVANCE_BOOKING_WINDOW_DAYS,
  cancelTierForHoursUntil,
  formatMoney,
  RESCHEDULE_FREE_COUNT,
  USD_PROCESSING_NOTE,
} from '../../../../lib/constants/business';
import { colors, spacing, insetBottom } from '../../../../lib/theme';

const MOCK_TIMES = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];

function label12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}

export default function ReschedulePick() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, rescheduleBooking } = useBookings();
  const currency = useAuth((s) => s.currency);
  const booking = bookings.find((b) => b.id === id);
  const [date, setDate] = React.useState<string | null>(null);
  const [time, setTime] = React.useState<string | null>(null);
  const [flags, setFlags] = React.useState<Record<string, boolean | undefined>>({});
  const [slots, setSlots] = React.useState<string[]>([]);
  // Three genuinely different outcomes that all used to render as
  // "Checking availability…" forever, or worse as six invented times.
  const [slotState, setSlotState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const occasion = booking?.occasion ?? 'Events';
  const durationHours = booking?.durationHours ?? 1;

  // Availability window: real day flags from the slot engine in API mode;
  // deterministic mock flags offline (weekends read fully booked).
  React.useEffect(() => {
    let cancelled = false;
    const mock = () => {
      const out: Record<string, boolean> = {};
      for (let i = 1; i <= ADVANCE_BOOKING_WINDOW_DAYS; i++) {
        const d = new Date(Date.now() + i * 86400_000);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        out[iso] = d.getDay() !== 0;
      }
      return out;
    };
    if (!apiConfigured) {
      setFlags(mock());
      return;
    }
    fetchDayFlags(occasion, durationHours).then((real) => {
      if (!cancelled) setFlags(real ?? mock());
    });
    return () => {
      cancelled = true;
    };
  }, [occasion, durationHours]);

  React.useEffect(() => {
    if (!date) return;
    setTime(null);
    if (!apiConfigured) {
      // No server at all — sample times so the flow is explorable.
      setSlots(MOCK_TIMES);
      setSlotState('ready');
      return;
    }
    let cancelled = false;
    setSlots([]);
    setSlotState('loading');
    fetchDaySlots(occasion, date, durationHours).then((s) => {
      if (cancelled) return;
      // NEVER fall back to invented times here. A fabricated slot list
      // gets picked, submitted, and rejected at the server — or books a
      // time no creator was actually matched for. (This was the last
      // surviving `?? MOCK` fallback.)
      if (s == null) {
        setSlots([]);
        setSlotState('error');
        return;
      }
      setSlots(s);
      setSlotState('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [date, occasion, durationHours]);

  if (!booking) return null;

  const confirmReschedule = async () => {
    if (!date || !time) return false;
    if (apiConfigured) {
      // Server enforces the fee tiers, the <24h cutoff, and re-checks that
      // this creator is still free at the new time.
      const result = await rescheduleBookingApi(booking.id, date, time);
      if (result && 'error' in result) {
        setError(result.error);
        return false; // slider unlocks so the user can retry
      }
      // null = API unreachable; fall through to the mock path.
    }
    rescheduleBooking(booking.id, `${date}T${time}:00`);
    router.dismissTo(`/bookings/${booking.id}`);
    return true;
  };

  // >1 free reschedule becomes cancel+rebook (§5)
  const usedFree = booking.rescheduleCount >= RESCHEDULE_FREE_COUNT;

  // 24–48 hrs out carries the 50% charge (same as cancelling in that band;
  // under 24h routes to reschedule-blocked before reaching this screen), so
  // the commit becomes slide-to-confirm with the charge shown. Free
  // reschedules keep a plain button.
  const feeApplies = cancelTierForHoursUntil(hoursUntil(booking.scheduledAt)) === 'between24and48h';
  const feeCharge = booking.priceUsd * 0.5;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Pick a new date & time" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.contextChip}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke="#8A6800" strokeWidth={1.8} strokeLinejoin="round" />
            <Circle cx="12" cy="10" r="2.3" stroke="#8A6800" strokeWidth={1.8} />
          </Svg>
          <Text style={styles.contextChipLabel}>
            {booking.area ?? 'your area'} · {durationHours} hour{durationHours === 1 ? '' : 's'}
          </Text>
        </View>

        {usedFree && (
          <View style={{ marginBottom: 14 }}>
            <InfoBanner
              tone="error"
              text="You've used your free reschedule for this booking. Additional changes are treated as a cancellation and re-booking, with the standard cancellation fee schedule."
            />
          </View>
        )}

        <Text style={styles.sectionLabel}>Pick a date</Text>
        <MonthCalendar flags={flags} selected={date} onSelect={setDate} />

        <Text style={[styles.sectionLabel, { marginTop: 22 }]}>Pick a time</Text>
        {date == null ? (
          <Text style={styles.hint}>Choose a date above to see open times.</Text>
        ) : slotState === 'loading' ? (
          <Text style={styles.hint}>Checking availability…</Text>
        ) : slotState === 'error' ? (
          <Text style={styles.hint}>
            Couldn't load open times just now. Check your connection and pick the date again —
            your booking is unchanged.
          </Text>
        ) : slots.length === 0 ? (
          <Text style={styles.hint}>
            No open times on this date for a {durationHours}-hour session. Try another day.
          </Text>
        ) : (
          <View style={styles.timeWrap}>
            {slots.map((t) => {
              const active = time === t;
              return (
                <Pressable key={t} onPress={() => setTime(t)} style={[styles.time, active && styles.timeActive]}>
                  <Text style={[styles.timeLabel, active && { color: colors.ink, fontWeight: '800' }]}>
                    {label12h(t)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Text style={styles.slotNote}>
          Only slots with a creator free for {durationHours} hour{durationHours === 1 ? '' : 's'} in
          your area are shown.
        </Text>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {feeApplies ? (
            <>
              <SlideToConfirm
                label="Slide to confirm reschedule"
                disabled={!date || !time}
                value={formatMoney(feeCharge, 'USD')}
                valueLabel="Reschedule charge (USD)"
                onConfirm={confirmReschedule}
              />
              <Text style={styles.usdNote}>
                {currency === 'XCD' ? `≈ ${formatMoney(feeCharge, 'XCD')} · ` : ''}
                {USD_PROCESSING_NOTE}
              </Text>
            </>
          ) : (
            <Button title="Confirm new time" arrow disabled={!date || !time} onPress={confirmReschedule} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0E9D8',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  contextChipLabel: { fontSize: 12.5, fontWeight: '700', color: '#8A6800' },
  sectionLabel: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginBottom: 12 },
  hint: { fontSize: 12.5, color: colors.greyWarm },
  timeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  time: {
    minWidth: '30%',
    flexGrow: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  timeLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  slotNote: { fontSize: 11, color: colors.greyWarm, marginTop: 12 },
  error: { fontSize: 12.5, color: colors.error, fontWeight: '600', marginBottom: 10 },
  usdNote: { fontSize: 11, color: colors.grey, lineHeight: 15.5, marginTop: 10, textAlign: 'center' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
  },
});
