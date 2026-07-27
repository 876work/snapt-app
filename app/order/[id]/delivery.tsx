import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { creatorById, useBookings } from '../../../lib/store';
import { colors } from '../../../lib/theme';

const DELIVERABLES = [
  { name: 'Sunset-reel-final.mp4', meta: '0:45 · 4K', thumb: require('../../../assets/design/bookings/p2.webp'), tint: '#6FD3E0' },
  { name: 'Golden-hour-01.jpg', meta: '24MP · retouched', thumb: require('../../../assets/design/bookings/p1.webp'), tint: '#F2C14E' },
  { name: 'Golden-hour-02.jpg', meta: '24MP · retouched', thumb: require('../../../assets/design/bookings/p3.webp'), tint: '#F2A0B5' },
  { name: 'Family-candids.jpg', meta: '24MP · retouched', thumb: require('../../../assets/design/bookings/p4.webp'), tint: '#8ED7A6' },
];

export default function Delivery() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const creator = creatorById(booking?.creatorId ?? null) ?? creatorById('jordan');
  const firstName = creator?.name.split(' ')[0] ?? 'your editor';

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your content" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.readyCard}>
          <View style={styles.readyIcon}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <View>
            <Text style={styles.readyTitle}>It's ready!</Text>
            <Text style={styles.readySub}>
              {DELIVERABLES.length} edited files, delivered by {firstName}.
            </Text>
          </View>
        </View>

        <View style={styles.grid}>
          {DELIVERABLES.map((d) => (
            <View key={d.name} style={styles.fileCard}>
              <View style={[styles.fileThumb, { backgroundColor: d.tint }]}>
                <Image source={d.thumb} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </View>
              <View style={styles.fileRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={styles.fileMeta}>{d.meta}</Text>
                </View>
                <View style={styles.dlBtn}>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M5 19h14" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
                  </Svg>
                </View>
              </View>
            </View>
          ))}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Pressable style={styles.cta}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M5 19h14" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" />
          </Svg>
          <Text style={styles.ctaLabel}>Download all</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/order/${id}/rating`)} style={styles.rateBtn}>
          <Text style={styles.rateLabel}>Rate your experience</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  readyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFF4D6',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
  },
  readyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  readySub: { fontSize: 12.5, color: '#8A7530', marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fileCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  fileThumb: { height: 96 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12 },
  fileName: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  fileMeta: { fontSize: 10.5, color: colors.grey, marginTop: 1 },
  dlBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#F6F1E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 10,
  },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  rateBtn: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
});
