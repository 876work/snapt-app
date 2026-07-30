import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { InfoBanner } from '../../components/ui/Misc';
import { useBookings, creatorById } from '../../lib/store';
import {
  apiConfigured,
  fetchMyBookings,
  submitContentReport,
  ServerBookingListItem,
} from '../../lib/api';
import { colors, spacing } from '../../lib/theme';

// Moderation intake (Policy 04 §6). The category maps 1:1 to the server's
// four tiers and drives auto-assigned severity + consequence automation —
// child-safety reports escalate to on-call staff immediately. Booking
// disputes (refunds, quality) are a separate flow on the order screens.
const CATEGORIES = [
  {
    value: 'general' as const,
    label: 'Something else',
    sub: 'A general problem or concern for our team',
  },
  {
    value: 'content_policy' as const,
    label: 'Content policy violation',
    sub: 'Content that breaks the Content & Usage Policy',
  },
  {
    value: 'sexual_violent_hate' as const,
    label: 'Sexual, violent, or hateful content',
    sub: 'Explicit, graphic, or hateful material',
  },
  {
    value: 'child_safety' as const,
    label: 'Child safety concern',
    sub: 'Involves a minor — escalated to our team immediately',
  },
];

type Category = (typeof CATEGORIES)[number]['value'];

export default function ReportProblem() {
  const router = useRouter();
  const mockBookings = useBookings((s) => s.bookings);
  const [serverBookings, setServerBookings] = React.useState<ServerBookingListItem[] | null>(null);
  const [myId, setMyId] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<Category | null>(null);
  const [bookingId, setBookingId] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (!apiConfigured) return;
    fetchMyBookings().then((b) => setServerBookings(b));
    import('../../lib/supabase').then(({ supabase }) => {
      supabase?.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
    });
  }, []);

  const bookings: { id: string; label: string; otherParty: string | null }[] = apiConfigured
    ? (serverBookings ?? []).map((b) => ({
        id: b.id,
        label: `${b.occasion ?? 'Remote edit'} · ${
          b.scheduled_at
            ? new Date(b.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        }`,
        // Report targets the other participant of the booking.
        otherParty: myId && b.client_id === myId ? b.creator_id : b.client_id,
      }))
    : mockBookings.map((b) => {
        const c = creatorById(b.creatorId);
        return {
          id: b.id,
          label: `${b.occasion}${c ? ` with ${c.name}` : ''} · ${new Date(b.scheduledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
          otherParty: null,
        };
      });

  const submit = async () => {
    if (!category || submitting) return;
    setSubmitting(true);
    setError(null);
    const selected = bookings.find((b) => b.id === bookingId);
    const result = await submitContentReport(
      category,
      details.trim(),
      apiConfigured ? (selected?.id ?? null) : null,
      apiConfigured ? (selected?.otherParty ?? null) : null,
    );
    setSubmitting(false);
    if (result && 'error' in result) {
      setError(result.error);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Report a problem" />
        <View style={styles.doneWrap}>
          <Text style={styles.doneTitle}>We got your report</Text>
          <Text style={styles.doneSub}>
            Our moderation team has been alerted and is reviewing it now. You'll hear from us if we
            need anything else.
          </Text>
          <Button title="Done" onPress={() => router.back()} style={{ marginTop: 22, alignSelf: 'stretch' }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Report a problem" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>What are you reporting?</Text>
        <View style={{ gap: 8 }}>
          {CATEGORIES.map((c) => {
            const active = category === c.value;
            return (
              <Pressable
                key={c.value}
                onPress={() => setCategory(c.value)}
                style={[styles.catRow, active && styles.catRowActive]}
              >
                <Text style={styles.catLabel}>{c.label}</Text>
                <Text style={styles.catSub}>{c.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 22 }]}>Is this about a booking?</Text>
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={() => setBookingId(null)}
            style={[styles.bkRow, bookingId === null && styles.bkRowActive]}
          >
            <Text style={styles.bkLabel}>Not about a specific booking</Text>
          </Pressable>
          {bookings.map((b) => {
            const active = bookingId === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() => setBookingId(b.id)}
                style={[styles.bkRow, active && styles.bkRowActive]}
              >
                <Text style={styles.bkLabel}>{b.label}</Text>
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
          <InfoBanner text="Reports go straight to our moderation team. Serious safety reports are escalated in real time. For refunds or delivery issues on a booking, open a dispute from the order screen instead." />
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <Button
          title={submitting ? 'Submitting…' : 'Submit report'}
          disabled={!category || !details.trim() || submitting}
          onPress={submit}
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
  catRow: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  catRowActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  catLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  catSub: { fontSize: 11.5, color: colors.greyWarm, marginTop: 3, lineHeight: 16 },
  bkRow: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  bkRowActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  bkLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  error: { fontSize: 12.5, fontWeight: '600', color: '#B4442E', marginTop: 12 },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingBottom: 80 },
  doneTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, textAlign: 'center' },
  doneSub: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10 },
});
