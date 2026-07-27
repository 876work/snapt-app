import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button } from '../../../../components/ui/Button';
import { colors } from '../../../../lib/theme';

export default function CancelDone() {
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
        <Text style={styles.title}>Booking cancelled</Text>
        <Text style={styles.sub}>
          Any refund due will go back to your original payment method within 5–10 business days.
          The service fee is non-refundable. You'll get a confirmation notification shortly.
        </Text>
      </View>
      <View style={styles.footer}>
        <Button title="Back to bookings" onPress={() => router.dismissTo('/bookings')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 14 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  sub: { fontSize: 13.5, lineHeight: 20, color: colors.grey, textAlign: 'center' },
  footer: { paddingHorizontal: 22, paddingBottom: 120 },
});
