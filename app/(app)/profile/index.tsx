import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Avatar, Card, SectionTitle } from '../../../components/ui/Misc';
import { useAuth } from '../../../lib/store';
import { colors, spacing } from '../../../lib/theme';

export default function Profile() {
  const router = useRouter();
  const { name, email, currency, setCurrency, signOut } = useAuth();

  const rows: { label: string; detail?: string; onPress: () => void }[] = [
    {
      label: 'Currency',
      detail: currency,
      onPress: () => setCurrency(currency === 'USD' ? 'XCD' : 'USD'),
    },
    { label: 'Notification settings', onPress: () => router.push('/profile/notifications') },
    { label: 'Emergency contacts', onPress: () => router.push('/profile/emergency') },
    { label: 'Help & Support', onPress: () => router.push('/help') },
    { label: 'Legal', onPress: () => router.push('/legal') },
  ];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Profile</Text>
        <Card style={styles.userCard}>
          <Avatar tint={colors.yellow} name={name || 'Y'} size={54} />
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{name || 'You'}</Text>
            <Text style={styles.userEmail}>{email}</Text>
          </View>
        </Card>

        <Pressable
          onPress={() =>
            Alert.alert('Creator mode', 'Switching to creator mode is coming soon.')
          }
          style={styles.creatorToggle}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.creatorToggleTitle}>Switch to creator mode</Text>
            <Text style={styles.creatorToggleSub}>Earn with your camera — coming soon</Text>
          </View>
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
            <Path d="M9 6l6 6-6 6" stroke="#C9A44C" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>

        <SectionTitle style={{ marginTop: 26, marginBottom: 12 }}>Settings</SectionTitle>
        <Card style={{ paddingVertical: 4, paddingHorizontal: 0 }}>
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              style={[styles.row, i < rows.length - 1 && styles.rowBorder]}
            >
              <Text style={styles.rowLabel}>{r.label}</Text>
              {r.detail && <Text style={styles.rowDetail}>{r.detail}</Text>}
              <Svg width={8} height={14} viewBox="0 0 8 14">
                <Path
                  d="M1 1l6 6-6 6"
                  stroke={colors.greyLight}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          ))}
        </Card>

        <Pressable
          onPress={() => {
            signOut();
            router.replace('/(auth)/welcome');
          }}
          style={styles.signOut}
        >
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>
        <View style={{ height: 130 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 70 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, marginBottom: 18 },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  userName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  userEmail: { fontSize: 12.5, color: colors.grey, marginTop: 2 },
  creatorToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1.5,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  creatorToggleTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  creatorToggleSub: { fontSize: 12, color: colors.goldText, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.ink },
  rowDetail: { fontSize: 13.5, color: colors.grey, fontWeight: '600' },
  signOut: { alignItems: 'center', paddingVertical: 22 },
  signOutLabel: { fontSize: 14, fontWeight: '700', color: colors.error },
});
