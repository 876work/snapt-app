import React from 'react';
import { AppState, type AppStateStatus, Linking, Pressable, StyleSheet, View } from 'react-native';
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
  const [blocked, setBlocked] = React.useState(false);
  const authing = React.useRef(false);
  /**
   * The 'active' AppState event lands AFTER authenticateAsync resolves, so a
   * flag cleared in `finally` is already false when it arrives. This holds the
   * door shut for a moment longer.
   */
  const settleUntil = React.useRef(0);

  const attempt = React.useCallback(async () => {
    if (authing.current) return;
    authing.current = true;
    try {
      const outcome = await unlock('Unlock Snapt');
      setBlocked(outcome === 'blocked');
      setNote(
        outcome === 'blocked'
          ? "Face ID is off for Snapt, so the lock can't check it's you. Turn it on in Settings, or switch App lock off."
          : outcome === 'bypassed'
            ? 'Unlocked without verification.'
            : null,
      );
      setLocked(false);
    } finally {
      authing.current = false;
      settleUntil.current = Date.now() + 1500;
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

  /**
   * RE-LOCK ONLY AFTER A REAL TRIP TO THE BACKGROUND.
   *
   * This listener used to re-lock on ANY transition to 'active', which is what
   * made the lock flicker in a loop: iOS reports 'inactive' while the Face ID
   * sheet is up and 'active' again when it closes, so every prompt triggered
   * the next one. Control Centre and the notification shade do the same.
   *
   * Requiring the previous state to be 'background' — and ignoring anything
   * that arrives while authenticating or just after — leaves exactly one
   * trigger: the app was genuinely away and came back.
   */
  const appState = React.useRef<AppStateStatus>(AppState.currentState);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;
      if (next !== 'active') return;
      if (prev !== 'background') return;
      if (authing.current || Date.now() < settleUntil.current) return;
      isAppLockEnabled().then((on) => {
        if (!on) return;
        setLocked(true);
        attempt();
      });
    });
    return () => sub.remove();
  }, [attempt]);

  if (!locked) {
    if (!note) return null;
    // "Try again" is useless once the OS has stopped asking; Settings is the
    // only route, so that is what the message offers.
    return blocked ? (
      <View style={styles.blockedWrap}>
        <Text style={styles.blockedText}>{note}</Text>
        <Pressable onPress={() => void Linking.openSettings()} hitSlop={8}>
          <Text style={styles.blockedLink}>Open Settings</Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.noteWrap} pointerEvents="none">
        <Text style={styles.note}>{note}</Text>
      </View>
    );
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
  blockedWrap: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 4,
    zIndex: 998,
  },
  blockedText: { fontSize: 11.5, color: colors.ink, lineHeight: 16 },
  blockedLink: { fontSize: 11.5, fontWeight: '800', color: colors.yellowDark },
  noteWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 4 },
  note: { fontSize: 11, color: colors.greyFaint },
});
