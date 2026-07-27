import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../../../components/ui/Misc';
import { OccasionIcon } from '../../../components/ui/Icons';
import { creatorById, useAuth, useBookings } from '../../../lib/store';
import { formatMoney } from '../../../lib/constants/business';
import { BookingStatus } from '../../../lib/mock/data';
import { colors, spacing } from '../../../lib/theme';

const STATUS_STYLE: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: colors.goldText, bg: colors.yellowTint },
  confirmed: { label: 'Confirmed', color: '#1E7A45', bg: '#E7F8EE' },
  completed: { label: 'Completed', color: colors.grey, bg: '#F0EEE8' },
  cancelled: { label: 'Cancelled', color: colors.errorDark, bg: colors.errorSoft },
  'no-show': { label: 'No-show', color: colors.errorDark, bg: colors.errorSoft },
  disputed: { label: 'Disputed', color: colors.errorDark, bg: colors.errorSoft },
};

export default function Bookings() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const bookings = useBookings((s) => s.bookings);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Bookings</Text>
        {bookings.map((b) => {
          const c = creatorById(b.creatorId);
          const d = new Date(b.scheduledAt);
          const st = STATUS_STYLE[b.status];
          return (
            <Pressable key={b.id} onPress={() => router.push(`/bookings/${b.id}`)} style={{ marginBottom: 10 }}>
              <Card style={styles.card}>
                <OccasionIcon occasion={b.occasion} size={30} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {b.occasion} {c ? `with ${c.name}` : ''}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
                    {d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {b.area ? ` · ${b.area}` : ''}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeLabel, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
                <Text style={styles.price}>{formatMoney(b.priceUsd, currency)}</Text>
              </Card>
            </Pressable>
          );
        })}
        <View style={{ height: 130 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 70 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, marginBottom: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  cardTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  cardMeta: { fontSize: 12, color: colors.grey, marginTop: 3 },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 6,
  },
  badgeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  price: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
