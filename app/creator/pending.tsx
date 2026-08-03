import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/store';
import { colors, insetBottom, insetTop } from '../../lib/theme';

// Creator application status screen: shown while vetting is in review.
// Re-checks the server on open so an approval flips the user into the
// creator app without needing a fresh sign-in.
export default function CreatorPending() {
  const router = useRouter();
  const setCreatorStatus = useAuth((s) => s.setCreatorStatus);

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
          <Svg width={34} height={34} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.8} />
            <Path d="M12 7.5V12l3 2" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
        <Text style={styles.title}>Application in review</Text>
        <Text style={styles.sub}>
          We're vetting your profile — this usually takes 2–3 days. We'll notify you the moment
          you're approved, and creator mode will unlock automatically.
        </Text>
      </View>
      <View style={styles.footer}>
        <Pressable onPress={() => router.replace('/(app)/profile')} style={styles.cta}>
          <Text style={styles.ctaLabel}>Back to profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite, paddingTop: insetTop },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  footer: { paddingHorizontal: 22, paddingBottom: Math.max(insetBottom + 12, 30) },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 16, fontWeight: '800', color: colors.ink },
});
