import React from 'react';
import { Animated, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { create } from 'zustand';

// Scroll-aware floating nav: scrolling down shrinks the pill to 70% size at
// 50% opacity; scrolling back up — or being near the top — restores it.
// Tab screens feed their ScrollView's onScroll into navShrinkOnScroll
// (scrollEventThrottle 32); both tab bars animate via useNavShrinkAnim.

const useNavShrink = create<{ shrunk: boolean; set: (v: boolean) => void }>((set) => ({
  shrunk: false,
  set: (shrunk) => set({ shrunk }),
}));

let lastY = 0;

export function navShrinkOnScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
  const y = e.nativeEvent.contentOffset.y;
  const delta = y - lastY;
  lastY = y;
  const { shrunk, set } = useNavShrink.getState();
  // Near the top the bar is always full size.
  if (y <= 30) {
    if (shrunk) set(false);
    return;
  }
  // Small threshold filters bounce/jitter (and the offset jump that happens
  // when switching between screens with different scroll positions).
  if (delta > 4 && !shrunk) set(true);
  else if (delta < -4 && shrunk) set(false);
}

/** Restore the bar instantly (used when switching tabs). */
export function navShrinkReset(): void {
  lastY = 0;
  if (useNavShrink.getState().shrunk) useNavShrink.getState().set(false);
}

export function useNavShrinkAnim(): { opacity: Animated.AnimatedInterpolation<number>; scale: Animated.AnimatedInterpolation<number> } {
  const shrunk = useNavShrink((s) => s.shrunk);
  const anim = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.timing(anim, { toValue: shrunk ? 0 : 1, duration: 180, useNativeDriver: true }).start();
  }, [shrunk, anim]);
  return {
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
    scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
  };
}
