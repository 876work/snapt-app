import React from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * OS reduce-motion, live. Screens with decorative animation check this and
 * skip it entirely when on — an accessibility requirement, not a preference.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
