import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';

// Tabs per handoff §13: All, Bookings, Messages, Promotions. Critical items
// get an accent indicator, no separate tab.
const TABS = ['All', 'Bookings', 'Messages', 'Promotions'] as const;

const ITEMS = [
  { id: 'n1', cat: 'Bookings', title: 'Booking confirmed', body: 'Portraits with Jordan M. is locked in for Wed, 29 Jul, 10:30 AM.', critical: false, time: '2h' },
  { id: 'n2', cat: 'Bookings', title: 'Reminder: session tomorrow', body: 'Family with Amara J. — Derek Walcott Square, Castries.', critical: false, time: '5h' },
  { id: 'n3', cat: 'Messages', title: 'New message from Jordan', body: '"See you at the causeway entrance!"', critical: false, time: '1d' },
  { id: 'n4', cat: 'Bookings', title: 'Refund processed', body: 'Your refund of $130 is on its way to your card.', critical: true, time: '1d' },
  { id: 'n5', cat: 'Promotions', title: 'Golden hour weekends', body: '10% off sunset sessions this month.', critical: false, time: '3d' },
];

export default function Inbox() {
  const [tab, setTab] = React.useState<(typeof TABS)[number]>('All');
  const items = ITEMS.filter((i) => tab === 'All' || i.cat === tab);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Notifications" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabRow}
      >
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} contentContainerStyle={styles.body}>
        {items.map((i) => (
          <View key={i.id} style={styles.item}>
            {i.critical && <View style={styles.accent} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{i.title}</Text>
              <Text style={styles.itemBody}>{i.body}</Text>
            </View>
            <Text style={styles.time}>{i.time}</Text>
          </View>
        ))}
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  tabRow: { paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  tab: {
    height: 34,
    paddingHorizontal: 15,
    borderRadius: 17,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tabLabel: { fontSize: 12.5, fontWeight: '700', color: colors.grey },
  tabLabelActive: { color: colors.yellow },
  body: { paddingHorizontal: 20 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  accent: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.yellow },
  itemTitle: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  itemBody: { fontSize: 12, color: colors.grey, marginTop: 3, lineHeight: 17 },
  time: { fontSize: 11, color: colors.greyLight, fontWeight: '600' },
});
