import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '../lib/text';
import { useAccountDisabled } from '../lib/api';
import { signOutEverywhere } from '../lib/auth';
import { colors, spacing } from '../lib/theme';

/**
 * Blocking modal for an account switched off mid-session.
 *
 * Mounted once at the root so it covers whatever screen the user is on when
 * the server refuses them. Deliberately has no dismiss path — no backdrop
 * tap, no hardware back (onRequestClose signs out rather than closing) — a
 * user whose access was revoked must not be able to keep poking at a UI that
 * will refuse every request.
 *
 * The copy stays plain and points at support. It does NOT speculate about
 * why: the admin's reason is an internal audit record, not something to
 * relay to the person it was written about.
 */
export function AccountDisabledGate() {
  const router = useRouter();
  const { disabled, message, clear } = useAccountDisabled();
  const [busy, setBusy] = React.useState(false);

  const acknowledge = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // Sign out FIRST, then clear the flag — clearing first would briefly
    // expose the signed-in UI behind the modal.
    await signOutEverywhere();
    clear();
    setBusy(false);
    router.replace('/(auth)/login');
  }, [busy, clear, router]);

  return (
    <Modal visible={disabled} transparent animationType="fade" onRequestClose={acknowledge}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Account disabled</Text>
          <Text style={styles.body}>
            {message ??
              'Your Snapt account has been disabled. Contact hello@snaptcarib.app if you think this is a mistake.'}
          </Text>
          <Pressable onPress={acknowledge} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}>
            <Text style={styles.ctaLabel}>{busy ? 'Signing out…' : 'OK'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,26,26,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.screenX,
  },
  card: { backgroundColor: colors.offWhite, borderRadius: 20, padding: 22, width: '100%' },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  body: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  cta: {
    marginTop: 20,
    height: 50,
    borderRadius: 999,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
