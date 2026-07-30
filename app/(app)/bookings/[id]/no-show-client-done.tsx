import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button } from '../../../../components/ui/Button';
import { colors } from '../../../../lib/theme';

export default function NoShowClientDone() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Svg width={84} height={84} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="12" r="10" fill="#E7F8EE" />
          <Path
            d="M7.5 12.5l3 3 6-6.5"
            stroke={colors.success}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text style={styles.title}>Report filed — you're covered</Text>
        <Text style={styles.sub}>
          Your full refund is on its way back to your payment method. We can also rematch you with
          another creator for a new time, or leave it as a free cancellation — your choice, no
          penalty either way.
        </Text>
      </View>
      <View style={styles.footer}>
        <Button title="Rematch me" onPress={() => router.dismissTo('/home')} />
        <Button
          title="Just the refund, thanks"
          variant="ghost"
          onPress={() => router.dismissTo('/bookings')}
          style={{ marginTop: 10 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 14 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 13.5, lineHeight: 20, color: colors.grey, textAlign: 'center' },
  footer: { paddingHorizontal: 22, paddingBottom: 120 },
});
