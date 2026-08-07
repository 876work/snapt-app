import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';

/**
 * One-time contextual push re-prompt for creators.
 *
 * The signup priming screen appears exactly once; someone who taps "Not now"
 * is never asked again unless they find the toggle in Profile. For a creator
 * that silence is expensive — job offers expire 15 minutes after dispatch, so
 * no push means missed work.
 *
 * This asks again at the two moments the value is unmistakable: approval,
 * and going available. ONCE each, tracked on-device — a nudge at the right
 * moment, never a nag. It renders nothing when push is already delivering.
 */
const SEEN_KEY = 'snapt.push.nudge.';

export function PushOfferNudge({ trigger }: { trigger: 'approved' | 'available' }) {
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await AsyncStorage.getItem(SEEN_KEY + trigger)) return;
        const { getDeliveryStatus } = await import('../../lib/push');
        const status = await getDeliveryStatus();
        // Only when push genuinely wouldn't arrive — never re-ask someone
        // who is already set up.
        if (!cancelled && status.available && status.delivering !== true) setShow(true);
      } catch {
        /* old build without the native module — stay silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trigger]);

  const dismiss = async () => {
    setShow(false);
    await AsyncStorage.setItem(SEEN_KEY + trigger, '1');
  };

  const enable = async () => {
    setBusy(true);
    try {
      const { enablePush } = await import('../../lib/push');
      const ok = await enablePush();
      if (ok) {
        setEnabled(true);
        await AsyncStorage.setItem(SEEN_KEY + trigger, '1');
        setTimeout(() => setShow(false), 2200);
        return;
      }
      // OS prompt denied or blocked in Settings. One ask means one ask.
      await dismiss();
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;

  if (enabled) {
    return (
      <View style={[styles.card, styles.cardOk]}>
        <Text style={styles.okText}>✓ Notifications on — new job offers will reach you.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 3a6 6 0 00-6 6v3.3c0 .6-.2 1.2-.6 1.7L4 16h16l-1.4-2a2.9 2.9 0 01-.6-1.7V9a6 6 0 00-6-6z"
              fill={colors.ink}
            />
            <Circle cx="17.5" cy="6.5" r="3.4" fill={colors.error} />
          </Svg>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>
            {trigger === 'approved' ? "Don't miss your first job" : "You're on — can we reach you?"}
          </Text>
          <Text style={styles.body}>
            Job offers expire 15 minutes after they're sent. Turn on notifications so new jobs
            reach you in time.
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={enable} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}>
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.ctaLabel}>Turn on notifications</Text>
          )}
        </Pressable>
        <Pressable onPress={dismiss} hitSlop={8}>
          <Text style={styles.notNow}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: '#F4E7C0',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardOk: { backgroundColor: '#E8F6EC', borderColor: '#BFE4C9' },
  okText: { fontSize: 13, fontWeight: '700', color: '#1E7A45' },
  row: { flexDirection: 'row', gap: 11 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '800', color: colors.ink },
  body: { fontSize: 12.5, color: '#8A7530', lineHeight: 18, marginTop: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
  cta: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 13, fontWeight: '800', color: colors.ink },
  notNow: { fontSize: 12.5, fontWeight: '700', color: '#8A7530' },
});
