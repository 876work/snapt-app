import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../../lib/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function InfoBanner({
  text,
  tone = 'gold',
}: {
  text: string;
  tone?: 'gold' | 'error';
}) {
  const isGold = tone === 'gold';
  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: isGold ? colors.yellowSoft : colors.errorSoft,
          borderColor: isGold ? colors.yellowSoftBorder : colors.errorSoftBorder,
        },
      ]}
    >
      <Text
        style={{
          fontSize: 12,
          lineHeight: 17.5,
          fontWeight: '600',
          color: isGold ? '#8A6800' : colors.errorDark,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

export function SectionTitle({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <Text style={[styles.section, style as object]}>{children}</Text>;
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <View style={styles.hr} />;
  return (
    <View style={styles.dividerRow}>
      <View style={styles.hrFlex} />
      <Text style={styles.dividerLabel}>{label}</Text>
      <View style={styles.hrFlex} />
    </View>
  );
}

export function Avatar({ tint, name, size = 46 }: { tint: string; name: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: '#fff' }}>
        {name.charAt(0)}
      </Text>
    </View>
  );
}

export function VerifiedBadge() {
  return (
    <View style={styles.verified}>
      <Text style={{ fontSize: 9, fontWeight: '800', color: colors.ink }}>✓ VERIFIED</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  banner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  section: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  hr: { height: 1, backgroundColor: colors.divider },
  hrFlex: { flex: 1, height: 1, backgroundColor: colors.divider },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLabel: { fontSize: 11, fontWeight: '700', color: colors.greyFaint },
  verified: {
    backgroundColor: colors.yellow,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
