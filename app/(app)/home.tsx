import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { BoltIcon, OccasionIcon } from '../../components/ui/Icons';
import { Avatar, Card, SectionTitle, VerifiedBadge } from '../../components/ui/Misc';
import { QuickBookSheet } from '../../components/home/QuickBookSheet';
import { creatorById, useAuth, useBookings } from '../../lib/store';
import { CREATORS } from '../../lib/mock/data';
import { formatMoney } from '../../lib/constants/business';
import { colors, spacing } from '../../lib/theme';

export default function Home() {
  const router = useRouter();
  const { name, currency, setCurrency } = useAuth();
  const bookings = useBookings((s) => s.bookings);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const upcoming = bookings.filter((b) => b.status === 'confirmed');

  return (
    <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.greetSub}>Good to see you,</Text>
            <Text style={styles.greet}>{name || 'friend'}</Text>
          </View>
          <Pressable
            onPress={() => setCurrency(currency === 'USD' ? 'XCD' : 'USD')}
            style={styles.currencyPill}
          >
            <Text style={styles.currencyLabel}>{currency}</Text>
            <Svg width={10} height={7} viewBox="0 0 12 8" fill="none">
              <Path
                d="M1 1.5L6 6.5L11 1.5"
                stroke={colors.grey}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        </View>

        <Pressable onPress={() => setSheetOpen(true)} style={styles.heroCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Book a creator</Text>
            <Text style={styles.heroSub}>
              Vetted photographers & videographers, matched to your moment.
            </Text>
          </View>
          <View style={styles.heroBolt}>
            <BoltIcon size={26} color={colors.ink} />
          </View>
        </Pressable>

        <Pressable onPress={() => router.push('/upload')} style={styles.uploadCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.uploadTitle}>Upload footage</Text>
            <Text style={styles.uploadSub}>Already shot it? A Snapt editor takes it from here.</Text>
          </View>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M6.5 18a4 4 0 01-.5-7.97A5.5 5.5 0 0117 9.5a3.5 3.5 0 011 6.9"
              stroke={colors.yellowDark}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M12 12v6M9.5 14.2L12 11.7l2.5 2.5"
              stroke={colors.yellowDark}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>

        {upcoming.length > 0 && (
          <>
            <SectionTitle style={{ marginTop: 26, marginBottom: 12 }}>Coming up</SectionTitle>
            {upcoming.map((b) => {
              const c = creatorById(b.creatorId);
              const d = new Date(b.scheduledAt);
              return (
                <Pressable
                  key={b.id}
                  onPress={() => router.push(`/bookings/${b.id}`)}
                  style={{ marginBottom: 10 }}
                >
                  <Card style={styles.upcomingCard}>
                    <OccasionIcon occasion={b.occasion} size={30} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.upTitle}>
                        {b.occasion} {c ? `with ${c.name}` : ''}
                      </Text>
                      <Text style={styles.upMeta}>
                        {d.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        ·{' '}
                        {d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ·{' '}
                        {b.area}
                      </Text>
                    </View>
                    <Text style={styles.upPrice}>{formatMoney(b.priceUsd, currency)}</Text>
                  </Card>
                </Pressable>
              );
            })}
          </>
        )}

        <SectionTitle style={{ marginTop: 26, marginBottom: 12 }}>Creators nearby</SectionTitle>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -spacing.screenX }}
          contentContainerStyle={{ paddingHorizontal: spacing.screenX, gap: 12 }}
        >
          {CREATORS.map((c) => (
            <Card key={c.id} style={styles.creatorCard}>
              <Avatar tint={c.tint} name={c.name} size={54} />
              <Text style={styles.creatorName}>{c.name}</Text>
              <Text style={styles.creatorMeta}>
                ★ {c.rating.toFixed(1)} · {c.sessions} sessions
              </Text>
              {c.verified && <VerifiedBadge />}
            </Card>
          ))}
        </ScrollView>

        <View style={{ height: 130 }} />
      </ScrollView>

      {/* FAB */}
      <Pressable onPress={() => setSheetOpen(true)} style={styles.fab}>
        <BoltIcon size={24} />
      </Pressable>

      <QuickBookSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.screenX, paddingTop: 70 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greetSub: { fontSize: 13, color: colors.grey },
  greet: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: colors.ink },
  currencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 36,
  },
  currencyLabel: { fontSize: 13, fontWeight: '800', color: colors.ink },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.yellow,
    borderRadius: 20,
    padding: 20,
    marginTop: 22,
    shadowColor: colors.yellow,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  heroTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  heroSub: { fontSize: 12.5, color: '#7A5B00', marginTop: 5, lineHeight: 17.5 },
  heroBolt: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  uploadTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  uploadSub: { fontSize: 12, color: '#8A6800', marginTop: 3, lineHeight: 16.5 },
  upcomingCard: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  upTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  upMeta: { fontSize: 12, color: colors.grey, marginTop: 3 },
  upPrice: { fontSize: 15, fontWeight: '800', color: colors.ink },
  creatorCard: { width: 140, alignItems: 'center', gap: 7, paddingVertical: 18 },
  creatorName: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  creatorMeta: { fontSize: 11, color: colors.grey },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 108,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOpacity: 0.34,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
