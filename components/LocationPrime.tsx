import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../lib/text';
import { Button } from './ui/Button';
import { colors, insetBottom } from '../lib/theme';

// Location permission priming (When In Use ONLY — never Always).
//
// iOS fires its system prompt exactly once per install; a "no" there is
// permanent until the user digs into Settings. So the OS prompt is only ever
// fired from behind this sheet, after the user has said yes to US first:
//  - "Not now" here never touches the OS prompt — the user stays askable.
//  - Everything works without location: manual pin + area picking remain.
//
// Storage: 'snapt.location.primed' marks that the sheet has been shown once
// (it re-offers via the "Use my location" button, never as a nag).

const PRIMED_KEY = 'snapt.location.primed';

export async function wasLocationPrimed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRIMED_KEY)) === '1';
  } catch {
    return true; // storage failure → don't risk burning the one-shot prompt flow twice
  }
}

export async function markLocationPrimed(): Promise<void> {
  try {
    await AsyncStorage.setItem(PRIMED_KEY, '1');
  } catch {
    // best-effort
  }
}

/**
 * Ask for When-In-Use permission the safe way:
 *  - never primed + undetermined → resolve 'show-prime' (caller opens sheet)
 *  - undetermined (already primed) → fire the OS prompt
 *  - denied but canAskAgain=false → 'settings' (caller shows the soft prompt)
 */
export async function locationPermissionState(): Promise<
  'granted' | 'undetermined' | 'denied-forever'
> {
  const Location = await import('expo-location');
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return 'granted';
  if (current.canAskAgain) return 'undetermined';
  return 'denied-forever';
}

export function LocationPrimeSheet({
  visible,
  onDone,
}: {
  visible: boolean;
  /** granted → caller may use location right away. */
  onDone: (granted: boolean) => void;
}) {
  const [busy, setBusy] = React.useState(false);

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    await markLocationPrimed();
    try {
      const Location = await import('expo-location');
      // When In Use only — foreground permission. We never request Always.
      const result = await Location.requestForegroundPermissionsAsync();
      onDone(result.granted);
    } catch {
      onDone(false);
    } finally {
      setBusy(false);
    }
  };

  const notNow = async () => {
    // Deliberately does NOT fire the system prompt — the one-shot stays
    // unspent and we can offer again when location would genuinely help.
    await markLocationPrimed();
    onDone(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={notNow}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.art}>
            <Svg width={64} height={64} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"
                fill={colors.yellow}
                stroke={colors.ink}
                strokeWidth={1.2}
              />
              <Circle cx="12" cy="10" r="2.6" fill={colors.ink} />
            </Svg>
          </View>
          <Text style={styles.title}>Meet in the right place</Text>
          <Text style={styles.sub}>
            Share your location and we'll centre the map where you are — so your pin lands on the
            right spot and nobody's waiting at the wrong beach. We only use it while you're in the
            app, never in the background.
          </Text>
          <Button title={busy ? 'One sec…' : 'Share my location'} arrow onPress={allow} />
          <Pressable onPress={notNow}>
            <Text style={styles.notNow}>Not now — I'll drop the pin myself</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: Math.max(insetBottom + 12, 30),
  },
  art: { alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.ink, textAlign: 'center' },
  sub: {
    fontSize: 14,
    lineHeight: 20.5,
    color: colors.grey,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 18,
  },
  notNow: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.grey,
    textAlign: 'center',
    paddingVertical: 14,
  },
});
