import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button } from '../../../../components/ui/Button';
import { RESCHEDULE_DISABLED_UNDER_HOURS } from '../../../../lib/constants/business';
import { colors } from '../../../../lib/theme';

// Rescheduling under 24 hours is disabled entirely (widened from 6h —
// Don, 2026-07-27). The only paths inside that window are cancellation
// (normal fee tiers) or support.
export default function RescheduleBlocked() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Svg width={84} height={84} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="12" r="10" fill={colors.errorSoft} />
          <Path d="M12 7v6" stroke={colors.errorDark} strokeWidth={2.2} strokeLinecap="round" />
          <Circle cx="12" cy="16.5" r="1.2" fill={colors.errorDark} />
        </Svg>
        <Text style={styles.title}>Too close to reschedule</Text>
        <Text style={styles.sub}>
          Your session starts in under {RESCHEDULE_DISABLED_UNDER_HOURS} hours, so rescheduling is
          no longer available. Your creator has already planned around this time. If you can't make
          it, you can cancel — the late-cancellation fee schedule applies — or contact support.
        </Text>
      </View>
      <View style={styles.footer}>
        <Button title="Back to booking" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 14 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  sub: { fontSize: 13.5, lineHeight: 20, color: colors.grey, textAlign: 'center' },
  footer: { paddingHorizontal: 22, paddingBottom: 44 },
});
