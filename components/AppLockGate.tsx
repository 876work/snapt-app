import React from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../lib/text';
import { colors } from '../lib/theme';
import { isAppLockEnabled, unlock } from '../lib/biometrics';

/**
 * The optional app-start lock. Renders nothing at all unless the person has
 * turned it on in Profile — off is the default and absence of the setting
 * means off.
 *
 * Every outcome ends unlocked (see lib/biometrics). A bypass is announced
 * rather than hidden, because someone who enabled this should be told when it
 * did not actually verify them.
 */
export function AppLockGate() {
  const [locked, setLocked] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const running = React.useRef(false);

  const attempt = React.useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const outcome = await unlock('Unlock Snapt');
      setNote(outcome === 'bypassed' ? 'Unlocked without verification.' : null);
      setLocked(false);
    } finally {
      running.current = false;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    isAppLockEnabled().then((on) => {
      if (cancelled || !on) return;
      setLocked(true);
      attempt();
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Re-lock when the app has been away. Someone who turned this on expects it
  // on return, not only at cold start.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      isAppLockEnabled().then((on) => {
        if (!on) return;
        setLocked(true);
        attempt();
      });
    });
    return () => sub.remove();
  }, [attempt]);

  if (!locked) {
    return note ? (
      <View style={styles.noteWrap} pointerEvents="none">
        <Text style={styles.note}>{note}</Text>
      </View>
    ) : null;
  }

  return (
    <View style={styles.cover}>
      <Text style={styles.title}>Snapt is locked</Text>
      <Text style={styles.body}>Unlock with Face ID, Touch ID or your device passcode.</Text>
      {/* Always present: if the OS prompt was dismissed or never appeared,
          this is the way on. It is not a bypass of a security boundary —
          the lock is a privacy screen and says so. */}
      <Pressable onPress={attempt} style={styles.cta}>
        <Text style={styles.ctaLabel}>Unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.offWhite,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 8,
    zIndex: 999,
  },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  body: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center' },
  cta: {
    marginTop: 20,
    height: 52,
    paddingHorizontal: 30,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
  noteWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 4 },
  note: { fontSize: 11, color: colors.greyFaint },
});
