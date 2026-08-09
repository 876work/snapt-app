import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useAuth } from '../../lib/store';
import { useCreator } from '../../lib/store/creator';
import { formatMoney } from '../../lib/constants/business';
import { colors, insetTop } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';
import { ScheduleEditor } from '../../components/creator/ScheduleEditor';

export default function CreatorSchedule() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { offers, jobStages } = useCreator();
  const accepted = offers.filter((o) => jobStages[o.id] && jobStages[o.id] !== 'offer');
  // Real assigned bookings only. This screen used to carry three invented
  // rows — a "Wedding highlight edit · Due Thu, 31 Jul" for $108.80 — shown
  // whenever the API was unconfigured. Suppressed in production, but it is
  // the same demo-shell pattern the order tracker had, and a fabricated job
  // with a fabricated deadline has no business in a screen about deadlines.

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Schedule</Text>
      </View>
      <ScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {accepted.map((j) => (
          <View key={j.id}>
            <Text style={styles.dayLabel}>JUST ACCEPTED</Text>
            <Pressable onPress={() => router.push(`/creator/job/${j.id}`)} style={styles.card}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle}>{j.title}</Text>
                <View style={styles.metaRow}>
                  <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                    <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.grey} strokeWidth={1.8} />
                    <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                  <Text style={styles.metaLabel}>{j.when}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                    <Circle cx="12" cy="10" r="2.3" stroke={colors.grey} strokeWidth={1.8} />
                  </Svg>
                  <Text style={styles.metaLabel}>{j.loc}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={styles.pay}>{formatMoney(j.payUsd, currency)}</Text>
                <View style={[styles.statusPill, { backgroundColor: '#E6F7EE' }]}>
                  <Text style={[styles.statusLabel, { color: '#159A57' }]}>Accepted</Text>
                </View>
              </View>
            </Pressable>
          </View>
        ))}
        {/* History lives here, not in the queue: finished work is a lookup,
            and mixing it in buried the jobs that actually needed doing. */}
        <Pressable onPress={() => router.push('/creator/history')} style={styles.historyRow}>
          <Text style={styles.historyLabel}>Past & completed jobs</Text>
          <Text style={styles.historyChevron}>›</Text>
        </Pressable>
        <Text style={styles.blockNote}>
          Need time off? Blocked dates sync automatically — clients can't book you on days you mark
          unavailable.
        </Text>
        <View style={{ height: 130 }} />
        <ScheduleEditor />
        <View style={{ height: 110 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  historyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 6,
    shadowColor: colors.ink, shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  historyLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  historyChevron: { fontSize: 20, color: colors.greyWarm, fontWeight: '700' },
  root: { flex: 1, backgroundColor: colors.offWhite },
  header: { paddingTop: insetTop + 19, paddingHorizontal: 22, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35, color: colors.ink },
  body: { paddingHorizontal: 22, paddingTop: 12 },
  dayLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.yellowDark,
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 15,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardTitle: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  metaLabel: { fontSize: 11, color: colors.greyWarm },
  pay: { fontSize: 15, fontWeight: '800', color: colors.ink },
  statusPill: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  statusLabel: { fontSize: 9.5, fontWeight: '800' },
  blockNote: { fontSize: 11.5, color: '#9A948B', lineHeight: 17, marginTop: 20, paddingHorizontal: 2 },
});
