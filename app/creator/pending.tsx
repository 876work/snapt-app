import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/store';
import { safeBack } from '../../lib/nav';
import { colors, insetBottom, insetTop } from '../../lib/theme';

// Creator application status screen: shown while vetting is in review.
// Re-checks the server on open so an approval flips the user into the
// creator app without needing a fresh sign-in.
export default function CreatorPending() {
  const router = useRouter();
  const setCreatorStatus = useAuth((s) => s.setCreatorStatus);
  const [appliedAt, setAppliedAt] = React.useState<string | null>(null);

  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) return;
      fetchCreatorMe().then((me) => {
        if (me?.status) setCreatorStatus(me.status);
        if (me?.applied_at) setAppliedAt(me.applied_at);
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
          there's a decision, and creator mode unlocks automatically on approval.
        </Text>
        {appliedAt && (
          <Text style={styles.submittedAt}>
            Submitted {new Date(appliedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </Text>
        )}
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle}>What happens next</Text>
          <Text style={styles.nextItem}>1.  We review your specialties and portfolio.</Text>
          <Text style={styles.nextItem}>2.  For in-person work, your background check runs.</Text>
          <Text style={styles.nextItem}>3.  You get an email and notification with the decision.</Text>
        </View>
        <Pressable onPress={() => router.push('/help/contact')}>
          <Text style={styles.supportLink}>Questions? Contact support</Text>
        </Pressable>
      </View>
      <View style={styles.footer}>
        <Pressable onPress={() => safeBack('/(app)/profile')} style={styles.cta}>
          <Text style={styles.ctaLabel}>Back to profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  submittedAt: { fontSize: 12, fontWeight: '700', color: '#8A7530', marginTop: 14 },
  nextCard: {
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFEDE7',
    padding: 16,
    marginTop: 18,
    gap: 7,
  },
  nextTitle: { fontSize: 13.5, fontWeight: '800', color: '#1A1A1A', marginBottom: 3 },
  nextItem: { fontSize: 12.5, color: '#767676', lineHeight: 18 },
  supportLink: { fontSize: 12.5, fontWeight: '800', color: '#B98600', marginTop: 16, paddingVertical: 6 },
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
