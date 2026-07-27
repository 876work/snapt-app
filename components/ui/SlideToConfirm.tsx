import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  onConfirm: () => void;
  danger?: boolean;
}

/**
 * Required for actions with financial consequence (no-show reports, late
 * cancellation). Never used on "End session" — that must stay a plain tap
 * (handoff §11 deliberate exception).
 */
export function SlideToConfirm({ label, onConfirm, danger }: Props) {
  const x = useSharedValue(0);
  const [width, setWidth] = React.useState(0);
  const max = Math.max(width - KNOB - 10, 1);
  const done = useSharedValue(false);

  const pan = Gesture.Pan()
    .onChange((e) => {
      if (done.value) return;
      x.value = Math.min(Math.max(x.value + e.changeX, 0), max);
    })
    .onEnd(() => {
      if (done.value) return;
      if (x.value > max * 0.92) {
        done.value = true;
        x.value = withSpring(max);
        runOnJS(onConfirm)();
      } else {
        x.value = withSpring(0);
      }
    });

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + KNOB + 10 }));

  const accent = danger ? colors.error : colors.yellow;

  return (
    <View
      style={[styles.track, { borderColor: danger ? colors.errorSoftBorder : colors.yellowSoftBorder }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.fill, { backgroundColor: accent + '33' }, fillStyle]} />
      <Text style={styles.label}>{label}</Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, { backgroundColor: accent }, knobStyle]}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path
              d="M9 6l6 6-6 6"
              stroke={danger ? '#fff' : colors.ink}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: H,
    borderRadius: H / 2,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: H / 2,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
});
