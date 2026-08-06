import React from 'react';
import {
  Keyboard,
  KeyboardEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  ScrollViewProps,
  TextInput,
} from 'react-native';

/**
 * The app's ONE scrolling container for screens that contain text inputs.
 *
 * The root layout already shrinks the screen above the keyboard (so pinned
 * footers and their Continue/submit buttons stay reachable). This adds the
 * other half: when the keyboard opens, the focused field is scrolled into
 * the remaining visible area — measured, not guessed, so iOS and Android
 * behave the same.
 *
 * Also standard here: taps outside a field dismiss the keyboard, and a tap
 * on a button works first time instead of only dismissing.
 */
const BREATHING_ROOM = 20;

/** ScrollView measures like any host view; the public types just omit it. */
type Measurable = {
  measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void;
};

export const KeyboardScrollView = React.forwardRef<ScrollView, ScrollViewProps>(
  function KeyboardScrollView({ onScroll, scrollEventThrottle, children, ...rest }, forwardedRef) {
    const innerRef = React.useRef<ScrollView | null>(null);
    const offsetRef = React.useRef(0);

    React.useImperativeHandle(forwardedRef, () => innerRef.current as ScrollView);

    const handleScroll = React.useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        offsetRef.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      },
      [onScroll],
    );

    React.useEffect(() => {
      const sub = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
        const focused = TextInput.State.currentlyFocusedInput();
        const scroller = innerRef.current;
        if (!focused || !scroller) return;
        const keyboardTop = e.endCoordinates.screenY;
        // Measure the scroller itself: on screens with a pinned footer the
        // scroll viewport ends ABOVE the footer, so the keyboard top is the
        // wrong target — a field parked there hides behind the footer.
        // measureInWindow runs after the shell shrank, so both are the
        // coordinates the user is actually looking at.
        (scroller as unknown as Measurable).measureInWindow((_sx, sy, _sw, sh) => {
          const visibleBottom = Math.min(
            typeof sy === 'number' && typeof sh === 'number' ? sy + sh : keyboardTop,
            keyboardTop,
          );
          const visibleTop = typeof sy === 'number' ? sy : 0;
          focused.measureInWindow((_x: number, y: number, _w: number, h: number) => {
            if (typeof y !== 'number' || typeof h !== 'number') return;
            const hiddenBelow = y + h + BREATHING_ROOM - visibleBottom;
            if (hiddenBelow > 0) {
              scroller.scrollTo({ y: offsetRef.current + hiddenBelow, animated: true });
              return;
            }
            // Field pushed off the top (long forms): bring it back down.
            const hiddenAbove = visibleTop + BREATHING_ROOM - y;
            if (hiddenAbove > 0) {
              scroller.scrollTo({ y: Math.max(0, offsetRef.current - hiddenAbove), animated: true });
            }
          });
        });
      });
      return () => sub.remove();
    }, []);

    return (
      <ScrollView
        ref={innerRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle ?? 16}
        {...rest}
      >
        {children}
      </ScrollView>
    );
  },
);
