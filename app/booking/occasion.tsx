import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { OccasionIcon } from '../../components/ui/Icons';
import { InfoBanner } from '../../components/ui/Misc';
import { OCCASIONS } from '../../lib/mock/data';
import { creatorById, useBookings } from '../../lib/store';
import { apiConfigured, fetchDayFlags, fetchDaySlots } from '../../lib/api';
import { ADVANCE_BOOKING_WINDOW_DAYS } from '../../lib/constants/business';
import { colors, spacing, insetBottom } from '../../lib/theme';

const TIMES = ['9:00', '10:30', '12:00', '14:00', '15:30', '17:00'];

// Duration is chosen on the next screen, so availability here is checked at
// the smallest package (1h); the server re-validates with the real duration
// at booking creation.
const AVAILABILITY_PROBE_HOURS = 1;

export default function OccasionAndDate() {
  const router = useRouter();
  const { bookAgain } = useLocalSearchParams<{ bookAgain?: string }>();
  const { draft, setDraft } = useBookings();

  // Real availability (API mode). null = mock mode or still loading — the
  // static prototype behavior stays untouched in that case.
  const [dayFlags, setDayFlags] = React.useState<Record<string, boolean> | null>(null);
  const [daySlots, setDaySlots] = React.useState<string[] | null>(null);
  const [slotsFailed, setSlotsFailed] = React.useState(false);
  const [slotsReloadKey, setSlotsReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!apiConfigured || !draft.occasion) return;
    let stale = false;
    setDayFlags(null);
    fetchDayFlags(draft.occasion, AVAILABILITY_PROBE_HOURS).then((flags) => {
      if (!stale) setDayFlags(flags);
    });
    return () => {
      stale = true;
    };
  }, [draft.occasion]);

  React.useEffect(() => {
    if (!apiConfigured || !draft.occasion || !draft.date) return;
    let stale = false;
    setDaySlots(null);
    setSlotsFailed(false);
    fetchDaySlots(draft.occasion, draft.date, AVAILABILITY_PROBE_HOURS).then((slots) => {
      if (stale) return;
      // null = the availability fetch FAILED. This used to fall through to
      // the hardcoded TIMES list — a picker fabricating times that may not
      // exist. Same cure reschedule got: loading, failed and empty are
      // three different states.
      if (slots == null) {
        setSlotsFailed(true);
        return;
      }
      setDaySlots(slots);
      // Deselect a time that's gone on the newly picked day.
      if (draft.time && !slots.includes(draft.time)) setDraft({ time: null });
    });
    return () => {
      stale = true;
    };
  }, [draft.occasion, draft.date, slotsReloadKey]);

  const days = React.useMemo(() => {
    /**
     * TODAY IS DAY ZERO. Same-day booking is allowed; what makes it safe is
     * the minimum lead time, which the SERVER applies when it returns the
     * day's slots — so today can appear here and still offer nothing bookable
     * if it is already too late in the day. The forward edge is unchanged:
     * the furthest day is still ADVANCE_BOOKING_WINDOW_DAYS out.
     */
    return Array.from({ length: ADVANCE_BOOKING_WINDOW_DAYS + 1 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400_000);
      return d;
    });
  }, []);

  const prefilledCreator = bookAgain ? creatorById(draft.creatorId) : undefined;
  const canContinue = !!draft.occasion && !!draft.date && !!draft.time;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Occasion & date" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {prefilledCreator && (
          <View style={{ marginBottom: 16 }}>
            <InfoBanner
              text={`Booking again with ${prefilledCreator.name} — we'll check they're free for your new date. If not, we'll match you with another great creator.`}
            />
          </View>
        )}
        <Text style={styles.sectionLabel}>What's the moment?</Text>
        <View style={styles.chipWrap}>
          {OCCASIONS.map((o) => {
            const active = draft.occasion === o;
            return (
              <Pressable
                key={o}
                onPress={() =>
                  setDraft(
                    o === 'Social'
                      ? { occasion: o, social: null, durationHours: null }
                      : { occasion: o, social: null },
                  )
                }
                style={[styles.chip, active && styles.chipActive]}
              >
                <OccasionIcon occasion={o} />
                <Text style={styles.chipLabel}>{o}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 26 }]}>Pick a day</Text>
        <Text style={styles.hint}>
          Sessions can be booked up to {ADVANCE_BOOKING_WINDOW_DAYS} days ahead.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -spacing.screenX }}
          contentContainerStyle={{ paddingHorizontal: spacing.screenX, gap: 9 }}
        >
          {days.map((d) => {
            const iso = d.toISOString().slice(0, 10);
            const active = draft.date === iso;
            // Real availability when the API answered; optimistic otherwise.
            const bookable = dayFlags ? dayFlags[iso] === true : true;
            return (
              <Pressable
                key={iso}
                disabled={!bookable}
                onPress={() => setDraft({ date: iso })}
                style={[styles.day, active && styles.dayActive, !bookable && styles.dayOff]}
              >
                <Text style={[styles.dayDow, active && { color: colors.ink }]}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <Text style={[styles.dayNum, active && { color: colors.ink }]}>{d.getDate()}</Text>
                <View style={[styles.dayDot, !bookable && { backgroundColor: colors.borderWarm }]} />
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={[styles.sectionLabel, { marginTop: 26 }]}>Pick a time</Text>
        {/* API mode: real slots only — loading, failed and empty are three
            distinct states. TIMES is the mock-mode demo list and nothing
            else; it used to render during loading AND on failure, letting
            people pick fabricated times. */}
        {apiConfigured && !draft.date ? (
          <Text style={styles.hint}>Pick a day to see open times.</Text>
        ) : apiConfigured && slotsFailed ? (
          <View>
            <Text style={styles.hint}>Couldn't load open times — check your connection.</Text>
            <Pressable onPress={() => setSlotsReloadKey((k) => k + 1)} style={styles.slotsRetry}>
              <Text style={styles.slotsRetryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : apiConfigured && draft.date && daySlots == null ? (
          <View style={{ paddingVertical: 14, alignItems: 'flex-start' }}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        ) : apiConfigured && daySlots?.length === 0 ? (
          <Text style={styles.hint}>No times left this day — try another date.</Text>
        ) : null}
        <View style={styles.chipWrap}>
          {(apiConfigured ? (daySlots ?? []) : TIMES).map((t) => {
            const active = draft.time === t;
            return (
              <Pressable
                key={t}
                onPress={() => setDraft({ time: t })}
                style={[styles.time, active && styles.chipActive]}
              >
                <Text style={[styles.timeLabel, active && { color: colors.ink }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Continue"
          arrow
          disabled={!canContinue}
          onPress={() => router.push('/booking/duration')}
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
  hint: { fontSize: 12, color: colors.grey, marginTop: -6, marginBottom: 12 },
  slotsRetry: { alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.yellow, marginBottom: 12 },
  slotsRetryLabel: { fontSize: 13, color: colors.ink },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  chipLabel: { fontSize: 11.5, fontWeight: '700', color: colors.ink },
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
  dayOff: { opacity: 0.45 },
  dayDow: { fontSize: 11, fontWeight: '700', color: colors.grey },
  dayNum: { fontSize: 17, fontWeight: '800', color: colors.ink },
  dayDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.success },
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
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
  },
});
