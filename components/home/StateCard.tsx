import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { HomeState } from '../../lib/homeState';
import { creatorById } from '../../lib/store';
import { colors } from '../../lib/theme';

/**
 * The "what's happening with my stuff" card. Sits ABOVE the search card
 * whenever there is anything personal to say.
 *
 * Every line is derived from a real booking — no state renders a claim the
 * data doesn't support (see homeState.ts for why delivery_ready keys off
 * deliveredAt rather than status alone).
 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, today)) return `Today ${time}`;
  if (sameDay(d, tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · ${time}`;
}

interface Copy {
  tag: string;
  tagTone: 'live' | 'soon' | 'ready' | 'calm';
  title: string;
  sub: string;
  cta: string;
  route: string;
}

function copyFor(state: HomeState): Copy | null {
  const b = state.booking;
  // Creator name only when we actually know it — never "your creator" dressed
  // up as a name.
  const creator = b?.creatorId ? creatorById(b.creatorId) : undefined;
  const firstName = creator?.name?.split(' ')[0] ?? null;
  const area = b?.area ?? null;

  switch (state.kind) {
    case 'session_now':
      return {
        tag: 'Happening now',
        tagTone: 'live',
        title: firstName ? `Your session with ${firstName}` : 'Your session is underway',
        sub: [when(b!.scheduledAt), area].filter(Boolean).join(' · '),
        cta: 'Open session',
        route: `/session/${b!.id}`,
      };
    case 'session_today':
      return {
        tag: 'Today',
        tagTone: 'soon',
        title: firstName ? `${b!.occasion} with ${firstName}` : `Your ${b!.occasion} session`,
        sub: [when(b!.scheduledAt), area, firstName ? `${firstName} is confirmed` : null]
          .filter(Boolean)
          .join(' · '),
        cta: 'View booking',
        route: `/(app)/bookings/${b!.id}`,
      };
    case 'delivery_ready':
      return {
        tag: 'Ready',
        tagTone: 'ready',
        title: 'Your photos are ready',
        sub: `${b!.occasion}${area ? ` · ${area}` : ''} — download and share them now.`,
        cta: 'View delivery',
        route: `/order/${b!.id}/delivery`,
      };
    case 'awaiting_creator':
      return {
        tag: 'Matching',
        tagTone: 'soon',
        title: 'Finding your creator',
        sub: [when(b!.scheduledAt), area, "we'll confirm as soon as one accepts"]
          .filter(Boolean)
          .join(' · '),
        cta: 'View booking',
        route: `/(app)/bookings/${b!.id}`,
      };
    case 'editing':
      return {
        tag: 'In progress',
        tagTone: 'calm',
        title: 'Your edit is underway',
        sub: "Your footage is with a Snapt editor — we'll let you know the moment it's ready.",
        cta: 'Track edit',
        route: `/order/${b!.id}`,
      };
    case 'upcoming':
      return {
        tag: 'Upcoming',
        tagTone: 'calm',
        title: firstName ? `${b!.occasion} with ${firstName}` : `Your ${b!.occasion} session`,
        sub: [when(b!.scheduledAt), area, firstName ? `${firstName} is confirmed` : null]
          .filter(Boolean)
          .join(' · '),
        cta: 'View booking',
        route: `/(app)/bookings/${b!.id}`,
      };
    case 'book_again': {
      const last = state.lastBooking;
      const lastCreator = last?.creatorId ? creatorById(last.creatorId) : undefined;
      const lastName = lastCreator?.name?.split(' ')[0] ?? null;
      return {
        tag: 'Welcome back',
        tagTone: 'calm',
        title: lastName ? `Book ${lastName} again` : 'Book another session',
        sub: lastName
          ? `You booked ${lastName} for ${last!.occasion}. Same standard pricing, no haggling.`
          : 'Standard pricing, no haggling — pick a moment and we handle the rest.',
        cta: 'Book again',
        route: '/booking/occasion',
      };
    }
    default:
      return null;
  }
}

const TONE: Record<Copy['tagTone'], { bg: string; fg: string; dot: string }> = {
  live: { bg: '#E7F8EE', fg: '#1E7A45', dot: '#1EC46F' },
  soon: { bg: colors.yellowSoft, fg: '#8A6800', dot: colors.yellow },
  ready: { bg: '#E9F3FF', fg: '#1F5FA8', dot: '#3E8BE0' },
  calm: { bg: '#F1EEE7', fg: '#6F6A60', dot: '#B8B2A6' },
};

export function StateCard({ state }: { state: HomeState }) {
  const router = useRouter();
  const copy = copyFor(state);
  if (!copy) return null;
  const tone = TONE[copy.tagTone];

  return (
    <Pressable onPress={() => router.push(copy.route as never)} style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.tag, { backgroundColor: tone.bg }]}>
          <View style={[styles.tagDot, { backgroundColor: tone.dot }]} />
          <Text style={[styles.tagLabel, { color: tone.fg }]}>{copy.tag}</Text>
        </View>
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
          <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
      <Text style={styles.title}>{copy.title}</Text>
      {!!copy.sub && <Text style={styles.sub}>{copy.sub}</Text>}
      <View style={styles.ctaRow}>
        <Text style={styles.cta}>{copy.cta}</Text>
        <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
          <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, height: 24, borderRadius: 12 },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.2 },
  title: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, marginTop: 10 },
  sub: { fontSize: 12.5, color: colors.grey, lineHeight: 18, marginTop: 4 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  cta: { fontSize: 13, fontWeight: '800', color: colors.yellowDark },
});
