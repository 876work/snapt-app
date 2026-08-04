import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/store';
import { colors, insetBottom, insetTop } from '../../lib/theme';

// Suspension state: creator mode is locked server-side (matching already
// excludes suspended creators; existing bookings are handled per policy by
// the admin flows). This screen explains the situation and the way back.
export default function CreatorSuspended() {
  const router = useRouter();
  const setCreatorStatus = useAuth((s) => s.setCreatorStatus);

  // Re-check on open so an admin unsuspension unlocks without re-login.
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorStatus }) => {
      if (!apiConfigured) return;
      fetchCreatorStatus().then((status) => {
        if (status) setCreatorStatus(status);
      });
    });
  }, [setCreatorStatus]);

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <View style={styles.icon}>
          <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
            <Rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="#767676" strokeWidth={1.8} />
            <Path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" stroke="#767676" strokeWidth={1.8} />
          </Svg>
        </View>
        <Text style={styles.title}>Your creator account is suspended</Text>
        <Text style={styles.sub}>
          Creator mode is locked while our team reviews your account. Any existing bookings are being
          handled under the Trust & Safety Policy — affected clients are refunded or rematched, and
          you won't receive new offers. If you believe this is a mistake, contact us and we'll review
          it with you.
        </Text>
      </View>
      <View style={styles.footer}>
        <Pressable onPress={() => router.push('/help/contact')} style={styles.cta}>
          <Text style={styles.ctaLabel}>Contact support</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/legal/trust-safety')} style={styles.ghostBtn}>
          <Text style={styles.ghostLabel}>Read the Trust & Safety Policy</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/(app)/profile')}>
          <Text style={styles.backLink}>Back to profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite, paddingTop: insetTop },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EFEDE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 13.5, color: colors.grey, lineHeight: 20.5, textAlign: 'center', marginTop: 12 },
  footer: { paddingHorizontal: 22, paddingBottom: Math.max(insetBottom + 12, 30), gap: 10 },
  cta: { height: 54, borderRadius: 16, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
  ctaLabel: { fontSize: 16, fontWeight: '800', color: colors.ink },
  ghostBtn: {
    height: 50,
    borderRadius: 15,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  backLink: { fontSize: 12.5, fontWeight: '700', color: colors.grey, textAlign: 'center', paddingVertical: 8 },
});
