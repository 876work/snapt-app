import React from 'react';
import { Dimensions, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useAuth } from '../../lib/store';
import { useReduceMotion } from '../../lib/useReduceMotion';
import {
  measureTarget,
  TOUR_STEPS,
  useTour,
  type TargetRect,
} from '../../lib/tour';
import { colors, insetBottom } from '../../lib/theme';

/**
 * The welcome card and the spotlight tour.
 *
 * A pure renderer: what to show comes from lib/tour, and WHEN to show it is
 * decided by Home, which is the only screen that knows every other
 * first-launch gate has cleared.
 *
 * Spotlights measure the real element every step. If a target is missing or
 * measures to nothing, that step is skipped rather than drawn — a halo over
 * empty space is worse than no tour.
 */
export function TourOverlay() {
  const phase = useTour((s) => s.phase);
  const step = useTour((s) => s.step);
  const beginSteps = useTour((s) => s.beginSteps);
  const next = useTour((s) => s.next);
  const end = useTour((s) => s.end);
  const name = useAuth((s) => s.name);
  const reduceMotion = useReduceMotion();
  const firstName = (name || '').trim().split(' ')[0];

  const [rect, setRect] = React.useState<TargetRect | null>(null);
  const { width, height } = Dimensions.get('window');

  // Measure the CURRENT step's element. Re-measured per step so a scroll or
  // layout change between steps cannot leave the halo behind.
  React.useEffect(() => {
    if (phase !== 'tour') return;
    let cancelled = false;
    const target = TOUR_STEPS[step]?.target;
    if (!target) return;
    measureTarget(target).then((r) => {
      if (cancelled) return;
      if (!r) {
        // Nothing to point at — move on rather than draw a halo over nothing.
        next();
        return;
      }
      setRect(r);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, step, next]);

  if (phase === 'idle') return null;

  if (phase === 'welcome') {
    return (
      <Modal transparent visible animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={end}>
        <View style={styles.welcomeScrim}>
          <View style={styles.welcomeCard}>
            {/* Reused carousel artwork — no new assets for this. */}
            <Image
              source={require('../../assets/design/onboarding/s1.webp')}
              style={styles.welcomeArt}
              resizeMode="cover"
            />
            <View style={styles.welcomeBody}>
              <Text style={styles.welcomeTitle}>
                {firstName ? `Welcome, ${firstName}` : 'Welcome to Snapt'}
              </Text>
              <Text style={styles.welcomeSub}>
                Book a local creator for a shoot, or send us footage you have already taken and
                we will edit it for you.
              </Text>
              <Pressable onPress={beginSteps} style={styles.primary}>
                <Text style={styles.primaryLabel}>Show me around</Text>
              </Pressable>
              <Pressable onPress={end} style={styles.ghost} hitSlop={8}>
                <Text style={styles.ghostLabel}>Skip</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const current = TOUR_STEPS[step];
  if (!current || !rect) return null;

  // Halo box, padded a little so the element does not sit flush to the edge.
  const pad = 8;
  const hx = Math.max(0, rect.x - pad);
  const hy = Math.max(0, rect.y - pad);
  const hw = rect.width + pad * 2;
  const hh = rect.height + pad * 2;
  // Caption goes below the element unless that would run off the screen.
  const below = hy + hh + 150 < height;

  return (
    <Modal transparent visible animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={end}>
      {/* Four scrim panels around the target, so the element itself stays
          fully visible and untinted — and tapping any of them advances. */}
      <Pressable style={[styles.scrim, { top: 0, left: 0, right: 0, height: hy }]} onPress={next} />
      <Pressable style={[styles.scrim, { top: hy + hh, left: 0, right: 0, bottom: 0 }]} onPress={next} />
      <Pressable style={[styles.scrim, { top: hy, left: 0, width: hx, height: hh }]} onPress={next} />
      <Pressable
        style={[styles.scrim, { top: hy, left: hx + hw, right: 0, height: hh }]}
        onPress={next}
      />

      <View pointerEvents="none" style={[styles.halo, { top: hy, left: hx, width: hw, height: hh }]} />

      <View
        pointerEvents="box-none"
        style={[
          styles.caption,
          below ? { top: hy + hh + 14 } : { bottom: height - hy + 14 },
          { width: Math.min(width - 44, 340) },
        ]}
      >
        <Text style={styles.captionStep}>
          {step + 1} of {TOUR_STEPS.length}
        </Text>
        <Text style={styles.captionTitle}>{current.title}</Text>
        <Text style={styles.captionBody}>{current.body}</Text>
        <View style={styles.captionRow}>
          <Pressable onPress={end} hitSlop={8}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
          <Pressable onPress={next} style={styles.nextBtn}>
            <Text style={styles.nextLabel}>
              {step === TOUR_STEPS.length - 1 ? 'Got it' : 'Next'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const SCRIM = 'rgba(16,16,16,0.72)';

const styles = StyleSheet.create({
  welcomeScrim: {
    flex: 1,
    backgroundColor: SCRIM,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  welcomeCard: { width: '100%', maxWidth: 380, borderRadius: 22, overflow: 'hidden', backgroundColor: '#fff' },
  welcomeArt: { width: '100%', height: 150 },
  welcomeBody: { padding: 22, gap: 10 },
  welcomeTitle: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  welcomeSub: { fontSize: 14, color: colors.grey, lineHeight: 21 },
  primary: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryLabel: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  ghost: { alignItems: 'center', paddingVertical: 12 },
  ghostLabel: { fontSize: 14, fontWeight: '700', color: colors.grey },

  scrim: { position: 'absolute', backgroundColor: SCRIM },
  halo: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: colors.yellow,
  },
  caption: {
    position: 'absolute',
    alignSelf: 'center',
    left: 22,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 5,
  },
  captionStep: { fontSize: 10.5, fontWeight: '800', color: colors.yellowDark, letterSpacing: 0.5 },
  captionTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  captionBody: { fontSize: 13.5, color: colors.grey, lineHeight: 20 },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  skip: { fontSize: 13.5, fontWeight: '700', color: colors.grey },
  nextBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.ink,
  },
  nextLabel: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  bottomPad: { height: insetBottom },
});
