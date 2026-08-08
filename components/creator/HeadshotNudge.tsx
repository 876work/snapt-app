import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';

/**
 * Backfill prompt for approved creators with no live headshot.
 *
 * Creators approved before the headshot requirement existed render as
 * initial-letter tiles on every client surface. Rather than silently
 * leaving them faceless, this card sits on the dashboard until a headshot
 * is uploaded (then pending review) — it disappears the moment one is
 * approved or in review.
 */
export function HeadshotNudge() {
  const router = useRouter();
  const [show, setShow] = React.useState(false);
  const [rejected, setRejected] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) return;
      fetchCreatorMe().then((me) => {
        if (cancelled || !me) return;
        const status = me.headshot_status ?? null;
        // Show when there's no headshot at all, or the last one was
        // rejected. Pending/approved need nothing from the creator.
        setShow(status === null || status === 'rejected');
        setRejected(status === 'rejected');
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <Pressable onPress={() => router.push('/creator/headshot')} style={styles.card}>
      <View style={styles.icon}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="8.5" r="3.6" stroke={colors.yellowDark} strokeWidth={2} />
          <Path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" stroke={colors.yellowDark} strokeWidth={2} strokeLinecap="round" />
        </Svg>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {rejected ? 'Your headshot needs a retake' : 'Add your headshot'}
        </Text>
        <Text style={styles.sub}>
          {rejected
            ? "The last upload didn't meet the guidelines — clients currently see a blank tile."
            : 'Clients see a blank tile where your face should be. A good headshot wins bookings.'}
        </Text>
      </View>
      <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
        <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.yellowSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    padding: 14,
    marginBottom: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 11.5, color: '#8A6800', lineHeight: 16.5, marginTop: 2 },
});
