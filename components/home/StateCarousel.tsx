import React from 'react';
import { AppState, Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import type { HomeState } from '../../lib/homeState';
import { StateCard } from './StateCard';
import { colors } from '../../lib/theme';

/**
 * Home's live-bookings carousel.
 *
 * One card per active booking, most imminent first. Renders NOTHING when the
 * list is empty — Home collapses to its normal layout rather than reserving
 * space or showing a placeholder.
 *
 * Auto-advance stops the moment the user takes over: touching the strip is a
 * statement of intent, and yanking the card out from under someone mid-read
 * is worse than never moving. It also stops while the app is backgrounded,
 * so returning to Home doesn't land on a card that scrolled past unseen.
 */
const INTERVAL_MS = 5000;
// Home's content padding is 20 per side; the card fills the width between.
const CARD_WIDTH = Dimensions.get('window').width - 40;

export function StateCarousel({ states }: { states: HomeState[] }) {
  const ref = React.useRef<ScrollView>(null);
  const [index, setIndex] = React.useState(0);
  // Two independent reasons to stop, tracked separately: coming back from the
  // background must NOT restart auto-advance for someone who took manual
  // control before leaving.
  const [userPaused, setUserPaused] = React.useState(false);
  const [foreground, setForeground] = React.useState(true);
  const paused = userPaused || !foreground;
  const count = states.length;

  // Clamp when the set shrinks under us — a booking cancelled while Home is
  // open must not leave the strip parked past the end.
  React.useEffect(() => {
    if (index > count - 1) {
      const next = Math.max(0, count - 1);
      setIndex(next);
      ref.current?.scrollTo({ x: next * CARD_WIDTH, animated: false });
    }
  }, [count, index]);

  React.useEffect(() => {
    if (paused || count < 2) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % count;
        ref.current?.scrollTo({ x: next * CARD_WIDTH, animated: true });
        return next;
      });
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused, count]);

  // Backgrounded apps shouldn't advance; timers are throttled anyway, but
  // this makes the intent explicit and resumes cleanly on return.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  if (count === 0) return null;
  if (count === 1) return <StateCard state={states[0]} />;

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH}
        // Taking hold of the strip ends auto-advance for this visit.
        onScrollBeginDrag={() => setUserPaused(true)}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH));
        }}
        scrollEventThrottle={16}
      >
        {states.map((s, i) => (
          <View key={s.booking?.id ?? i} style={{ width: CARD_WIDTH }}>
            <StateCard state={s} />
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {states.map((s, i) => (
          <View key={s.booking?.id ?? i} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: -4, marginBottom: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D8D2C6' },
  dotOn: { backgroundColor: colors.ink, width: 16 },
});
