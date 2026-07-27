import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { Avatar, InfoBanner, VerifiedBadge } from '../../components/ui/Misc';
import { useBookings } from '../../lib/store';
import { colors, spacing } from '../../lib/theme';

export default function CreatorAssignment() {
  const router = useRouter();
  const { draft, setDraft, eligibleCreators } = useBookings();

  // Hard filter: creators without this occasion as a specialty are excluded
  // entirely, never just deprioritized — handoff §7/§12.
  const creators = eligibleCreators().sort((a, b) => a.distanceKm - b.distanceKm);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your creator match" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          {draft.occasion
            ? `Creators who specialize in ${draft.occasion} near ${draft.area ?? 'you'}.`
            : 'Available creators near you.'}
        </Text>
        {creators.length === 0 && (
          <InfoBanner text="No specialists are free for this occasion right now. Try another date — availability changes daily." />
        )}
        <View style={{ gap: 12 }}>
          {creators.map((c, idx) => {
            const active = draft.creatorId === c.id;
            const best = idx === 0;
            return (
              <Pressable
                key={c.id}
                onPress={() => setDraft({ creatorId: c.id })}
                style={[styles.card, active && styles.cardActive]}
              >
                <Avatar tint={c.tint} name={c.name} size={54} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{c.name}</Text>
                    {c.verified && <VerifiedBadge />}
                  </View>
                  <Text style={styles.meta}>
                    ★ {c.rating.toFixed(1)} · {c.sessions} sessions · {c.distanceKm.toFixed(1)} km
                  </Text>
                  {best && draft.occasion && (
                    <Text style={styles.why}>
                      Best match — specializes in {draft.occasion} and is closest to your area.
                    </Text>
                  )}
                </View>
                <View style={[styles.radio, active && styles.radioActive]} />
              </Pressable>
            );
          })}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Continue"
          arrow
          disabled={!draft.creatorId}
          onPress={() => router.push('/booking/summary')}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  lead: { fontSize: 13.5, color: colors.grey, lineHeight: 19.5, marginBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 15,
  },
  cardActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 12, color: colors.grey, marginTop: 3 },
  why: { fontSize: 11.5, color: colors.yellowDark, fontWeight: '600', marginTop: 5, lineHeight: 16 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.greyLight },
  radioActive: { borderWidth: 6, borderColor: colors.yellow },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
  },
});
