import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/store';
import { colors, insetBottom, insetTop } from '../../lib/theme';
import { safeBack } from '../../lib/nav';

// Rejection state: shows the admin's reason and the path to reapply —
// never a blank screen or a spinner. Reapplying reopens the application
// with the previous answers as the starting draft (server keeps the row).
export default function CreatorRejected() {
  const router = useRouter();
  const setCreatorStatus = useAuth((s) => s.setCreatorStatus);
  const [reason, setReason] = React.useState<string | null>(null);

  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) {
        setReason('Portfolio did not meet our current quality bar.');
        return;
      }
      fetchCreatorMe().then((me) => {
        if (me?.status && me.status !== 'rejected') setCreatorStatus(me.status);
        setReason(me?.rejection_reason ?? 'No reason was recorded — contact support for details.');
      });
    });
  }, [setCreatorStatus]);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.icon}>
          <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="9" stroke="#B0392B" strokeWidth={1.8} />
            <Path d="M9 9l6 6M15 9l-6 6" stroke="#B0392B" strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        </View>
        <Text style={styles.title}>Your application wasn't approved</Text>
        <View style={styles.reasonCard}>
          <Text style={styles.reasonLabel}>REASON</Text>
          <Text style={styles.reasonText}>{reason ?? 'Loading…'}</Text>
        </View>
        <Text style={styles.sub}>
          You're welcome to apply again once this is addressed — your previous answers are saved as a
          starting point. If you think this was a mistake, contact us and we'll take another look.
        </Text>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          onPress={() => {
            // Reapply: the server allows a fresh submission from rejected.
            setCreatorStatus('in_progress');
            router.replace('/creator/apply');
          }}
          style={styles.cta}
        >
          <Text style={styles.ctaLabel}>Apply again</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/help/contact')} style={styles.ghostBtn}>
          <Text style={styles.ghostLabel}>Contact support</Text>
        </Pressable>
        <Pressable onPress={() => safeBack('/(app)/profile')}>
          <Text style={styles.backLink}>Back to profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 26, paddingTop: insetTop + 40, alignItems: 'center' },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, textAlign: 'center' },
  reasonCard: {
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F6D5D2',
    padding: 16,
    marginTop: 18,
  },
  reasonLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, color: '#B0392B' },
  reasonText: { fontSize: 13.5, color: colors.ink, lineHeight: 20, marginTop: 6 },
  sub: { fontSize: 13, color: colors.grey, lineHeight: 19.5, textAlign: 'center', marginTop: 16 },
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
