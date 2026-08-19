import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';

/** Red under two minutes — the ring, the digits and the label together. */
export const URGENT_REMAINING_MS = 2 * 60_000;

/** m:ss (or h:mm:ss past the hour — the window is admin-config, not fixed). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const SIZE = 96;
const STROKE = 7;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * THE OFFER WINDOW, AS A SHAPE.
 *
 * A creator glancing at a phone on a job reads "most of the ring is gone"
 * before they read any digits, which is the entire point of it — the digits
 * are for the person who wants the exact number, the ring is for the person
 * who has three seconds.
 *
 * NOT ANIMATED, deliberately. The arc is redrawn from the same one-second
 * tick that moves the digits, so the two can never disagree, and over a
 * 15-minute window one second is 0.4° — indistinguishable from a sweep.
 * There is therefore no animation for reduce-motion to disable: the ring is
 * a rendering of the current remaining time and nothing more. (A tweened
 * arc would need gating; this needs none, and cannot drift from the number
 * printed inside it.)
 */
export function OfferCountdownRing({
  remainMs,
  windowMs,
}: {
  remainMs: number;
  /** Full offer window (offer_window_minutes), so the ring knows its 100%. */
  windowMs: number;
}) {
  const urgent = remainMs < URGENT_REMAINING_MS;
  const accent = urgent ? colors.error : colors.yellow;
  // Clamped both ways: an offer opened late must not draw a negative arc,
  // and a clock skew that makes remaining exceed the window must not draw
  // more than a full one.
  const fraction = windowMs > 0 ? Math.min(1, Math.max(0, remainMs / windowMs)) : 0;

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE}>
        {/* Full track underneath, so the depleted portion stays legible as
            a shape rather than reading as a shorter ring. */}
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="#F1EEE7" strokeWidth={STROKE} fill="none" />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={accent}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          // Depletes clockwise from 12 o'clock as the window elapses.
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.digits, urgent && styles.digitsUrgent]}>
          {formatRemaining(remainMs)}
        </Text>
        <Text style={[styles.caption, urgent && styles.captionUrgent]}>left</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digits: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  digitsUrgent: { color: colors.error },
  caption: { fontSize: 9.5, fontWeight: '700', color: colors.greyWarm, marginTop: 1 },
  captionUrgent: { color: colors.error },
});
