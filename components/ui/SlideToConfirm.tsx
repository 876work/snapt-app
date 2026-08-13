import React from 'react';
import { AccessibilityActionEvent, ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../lib/theme';

const KNOB = 48;
const H = 58;

interface Props {
  label: string;
  /**
   * Return false (or throw) to signal failure: the slider unlocks and snaps
   * back so the user can retry after fixing the problem. Any other result
   * keeps it locked, so a completed slide can never fire twice.
   */
  onConfirm: () => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  /** Optional value bar above the track (payment-screen layout). */
  value?: string;
  valueLabel?: string;
}

/**
 * The one confirmation slider for the whole app. Required for actions that
 * charge money, cancel, delete, or can't be undone. Never used on
 * "End session" or anything in the SOS sheet — those must stay a plain tap
 * (handoff §11 deliberate exception).
 *
 * While onConfirm is in flight the thumb shows a spinner and the control is
 * locked, so a slow network can't cause a double charge. Screen-reader
 * users can activate it with a double-tap (drag alone isn't operable).
 */
export function SlideToConfirm({ label, onConfirm, disabled, value, valueLabel }: Props) {
  const x = useSharedValue(0);
  const [width, setWidth] = React.useState(0);
  const max = Math.max(width - KNOB - 10, 1);
  const done = useSharedValue(false);
  const lockRef = React.useRef(false);
  const [busy, setBusy] = React.useState(false);

  const complete = React.useCallback(async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    // The latch: the moment the slide is committed and can no longer be
    // taken back. Fire-and-forget — a device without a taptic engine, or one
    // with system haptics disabled, must not delay or fail the confirmation.
    import('expo-haptics')
      .then((H) => H.impactAsync(H.ImpactFeedbackStyle.Medium))
      .catch(() => undefined);
    setBusy(true);
    let ok = true;
    try {
      ok = (await onConfirm()) !== false;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (!ok) {
      // Failure: unlock and reset to the start position (the screen shows
      // its own error message).
      lockRef.current = false;
      done.value = false;
      x.value = withSpring(0);
    }
  }, [onConfirm, done, x]);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onChange((e) => {
      if (done.value) return;
      x.value = Math.min(Math.max(x.value + e.changeX, 0), max);
    })
    .onEnd(() => {
      if (done.value) return;
      // Fires only on a completed slide — a partial drag snaps back.
      if (x.value > max * 0.92) {
        done.value = true;
        x.value = withSpring(max);
        runOnJS(complete)();
      } else {
        x.value = withSpring(0);
      }
    });

  const activate = () => {
    if (disabled || lockRef.current) return;
    done.value = true;
    x.value = withSpring(max);
    complete();
  };

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + KNOB + 10 }));

  return (
    // width:'100%' — the control is a full-width commitment bar by design.
    // In a row-flexed parent a plain View shrinks to content width, which
    // squeezes the track and hides the label behind the thumb (the checkout
    // footer bug); every current usage is the sole child of its container.
    <View style={[{ width: '100%' }, disabled && { opacity: 0.45 }]}>
      {value != null && (
        <View style={styles.valueBar}>
          <Text style={styles.valueBarLabel}>{valueLabel ?? "You're paying"}</Text>
          <Text style={styles.valueBarValue}>{value}</Text>
        </View>
      )}
      <View
        style={styles.track}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Double tap to confirm this action"
        accessibilityState={{ disabled: !!disabled, busy }}
        accessibilityActions={[{ name: 'activate', label: 'Confirm' }]}
        onAccessibilityAction={(e: AccessibilityActionEvent) => {
          if (e.nativeEvent.actionName === 'activate') activate();
        }}
      >
        <Animated.View style={[styles.fill, fillStyle]} />
        <Text style={styles.label}>{label}</Text>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.knob, knobStyle]}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.ink} />
            ) : (
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M9 6l6 6-6 6"
                  stroke={colors.ink}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            )}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  valueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  valueBarLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.62)' },
  valueBarValue: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  track: {
    height: H,
    borderRadius: H / 2,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.yellowSoftBorder,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: H / 2,
    backgroundColor: colors.yellow + '33',
  },
  label: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.grey,
  },
  knob: {
    position: 'absolute',
    left: 5,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
