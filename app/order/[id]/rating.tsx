import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CreatorAvatar } from '../../../components/ui/CreatorAvatar';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { creatorById, useBookings } from '../../../lib/store';
import { colors, insetBottom } from '../../../lib/theme';

const CATEGORIES = ['Edit quality', 'Turnaround', 'Communication'];

export default function Rating() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const creator = creatorById(booking?.creatorId ?? null) ?? creatorById('jordan');

  const [stars, setStars] = React.useState<Record<string, number>>({});
  const [note, setNote] = React.useState('');
  const complete = CATEGORIES.every((c) => (stars[c] ?? 0) > 0);

  return (
    <View style={styles.root}>
      <ScreenHeader title="How did we do?" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center' }}>
          {creator && (
            <View style={styles.avatar}>
              <CreatorAvatar name={creator.name} photo={creator.photo} />
            </View>
          )}
          <Text style={styles.title}>Edited by {creator?.name ?? 'your editor'}</Text>
          <Text style={styles.sub}>Your files are downloaded. Rate the edit across a few areas.</Text>
        </View>

        <View style={{ gap: 10, marginTop: 24 }}>
          {CATEGORIES.map((c) => (
            <View key={c} style={styles.catRow}>
              <Text style={styles.catLabel}>{c}</Text>
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setStars((s) => ({ ...s, [c]: n }))} style={styles.star}>
                    <Text style={[styles.starGlyph, { color: (stars[c] ?? 0) >= n ? colors.yellow : '#E4E0D6' }]}>
                      ★
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note (optional)"
          placeholderTextColor="#9A9A9A"
          multiline
          style={styles.noteInput}
        />
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          disabled={!complete}
          onPress={() => {
            router.dismissAll();
            router.replace('/(app)/home');
          }}
          style={[styles.cta, !complete && { opacity: 0.45 }]}
        >
          <Text style={styles.ctaLabel}>Submit rating</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 14 },
  avatar: { width: 76, height: 76, borderRadius: 38, overflow: 'hidden', backgroundColor: '#EFEBE3', marginTop: 6 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 14 },
  sub: { fontSize: 13, color: colors.grey, marginTop: 3, textAlign: 'center', maxWidth: 260, lineHeight: 18 },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  catLabel: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  star: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  starGlyph: { fontSize: 26, lineHeight: 30 },
  noteInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#ECECEC',
    borderRadius: 14,
    padding: 14,
    marginTop: 22,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: '#fff',
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
});
