import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { useBookings } from '../../lib/store';
import { apiConfigured, fetchEligibleCreators } from '../../lib/api';
import { colors, spacing } from '../../lib/theme';

export default function CreatorAssignment() {
  const router = useRouter();
  const { draft, setDraft, eligibleCreators, registerCreators } = useBookings();
  const [auto, setAuto] = React.useState(true);

  // API mode: real approved creators from /v1/creators/eligible (§12 hard
  // filter runs server-side). null = mock mode or still loading.
  const [serverCreators, setServerCreators] = React.useState<
    ReturnType<typeof eligibleCreators> | null
  >(null);
  React.useEffect(() => {
    if (!apiConfigured || !draft.occasion) return;
    let stale = false;
    fetchEligibleCreators(draft.occasion, draft.area).then((list) => {
      if (stale || !list) return;
      setServerCreators(list);
      // Register so creatorById() resolves these ids on later screens.
      registerCreators(list);
    });
    return () => {
      stale = true;
    };
  }, [draft.occasion, draft.area]);

  // Hard filter: creators without this occasion as a specialty are excluded
  // entirely, never just deprioritized — handoff §7/§12.
  const creators =
    serverCreators ??
    eligibleCreators().sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
  const canContinue = auto || !!draft.creatorId;

  const pickAuto = () => {
    setAuto(true);
    // API mode: null lets the server auto-assign; mock mode keeps the old
    // best-match preview behavior.
    setDraft({ creatorId: serverCreators ? null : creators[0]?.id });
  };
  const pickCreator = (id: string) => {
    setAuto(false);
    setDraft({ creatorId: id });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your creator" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {creators.length > 0 ? (
          <>
            {creators.length === 1 ? (
              <View style={styles.limitedBanner}>
                <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                  <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.8} />
                  <Path d="M12 11v5" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
                  <Circle cx="12" cy="8" r="1.1" fill={colors.yellowDark} />
                </Svg>
                <Text style={styles.limitedText}>Only 1 creator available for this date and time.</Text>
              </View>
            ) : (
              <Text style={styles.lead}>
                Creators free {draft.date ? `on ${new Date(draft.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : 'that day'} near you — pick who you'd like, or let us match you.
              </Text>
            )}

            {/* Match me automatically */}
            <Pressable onPress={pickAuto} style={[styles.autoCard, auto && styles.autoCardActive]}>
              <View style={styles.autoIcon}>
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 3l2 4 4 .5-3 3 .8 4L12 16.8 8.2 18.5 9 14.5l-3-3 4-.5z" fill={colors.ink} />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.autoTitle}>Match me automatically</Text>
                <Text style={styles.autoSub}>We'll pick the best available creator for you.</Text>
              </View>
              {auto && (
                <View style={styles.autoCheck}>
                  <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 13l4 4L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </View>
              )}
            </Pressable>

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orLabel}>or choose yourself</Text>
              <View style={styles.orLine} />
            </View>

            <View style={{ gap: 12 }}>
              {creators.map((c, idx) => {
                const active = !auto && draft.creatorId === c.id;
                const best = idx === 0;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => pickCreator(c.id)}
                    style={[styles.card, active && styles.cardActive]}
                  >
                    <View style={[styles.photo, { backgroundColor: c.tint }]}>
                      <CreatorAvatar name={c.name} photo={c.photo} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name}>{c.name}</Text>
                        <View style={styles.ratingRow}>
                          <Svg width={11} height={11} viewBox="0 0 24 24" fill={colors.yellow}>
                            <Path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />
                          </Svg>
                          <Text style={styles.rating}>
                            {c.rating != null ? (
                              <>
                                {c.rating.toFixed(1)} <Text style={styles.reviews}>({c.sessions})</Text>
                              </>
                            ) : (
                              'New'
                            )}
                          </Text>
                        </View>
                      </View>
                      {c.verified && (
                        <View style={styles.verifiedPill}>
                          <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                            <Path d="M12 3l7 2.5v5.6c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.5L12 3z" fill={colors.success} />
                            <Path d="M9.2 12l2 2 3.6-3.6" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                          </Svg>
                          <Text style={styles.verifiedLabel}>Verified Creator</Text>
                        </View>
                      )}
                      <View style={styles.distRow}>
                        <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                          <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke="#8A8377" strokeWidth={1.8} strokeLinejoin="round" />
                          <Circle cx="12" cy="10" r="2.3" stroke="#8A8377" strokeWidth={1.8} />
                        </Svg>
                        <Text style={styles.dist}>
                          {c.distanceKm != null
                            ? `${c.distanceKm.toFixed(1)} km from your meeting area`
                            : c.loc || 'Saint Lucia'}
                        </Text>
                      </View>
                      {best && draft.occasion && (
                        <Text style={styles.why}>
                          Specializes in {draft.occasion}
                          {c.distanceKm != null
                            ? ' · closest to your area'
                            : c.loc && draft.area === c.loc
                              ? ` · based in ${c.loc}`
                              : ''}
                        </Text>
                      )}
                      <View style={styles.tagRow}>
                        {c.specialties.slice(0, 3).map((t) => (
                          <View key={t} style={styles.tag}>
                            <Text style={styles.tagLabel}>{t}</Text>
                          </View>
                        ))}
                      </View>
                      <Pressable
                        onPress={() => router.push({ pathname: '/booking/creator-preview', params: { id: c.id } })}
                        style={styles.previewRow}
                      >
                        <Text style={styles.previewLabel}>View profile</Text>
                        <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                          <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </Pressable>
                    </View>
                    {best && (
                      <View style={styles.bestBadge}>
                        <Text style={styles.bestLabel}>BEST MATCH</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                <Path d="M8 3v4M16 3v4" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
                <Path d="M3.5 6h17v12a3 3 0 01-3 3h-11a3 3 0 01-3-3V6z" stroke={colors.yellowDark} strokeWidth={1.8} />
                <Path d="M9 14l2 2 4-4" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={styles.emptyTitle}>No creators open just yet</Text>
            <Text style={styles.emptySub}>
              No creators are available at this location yet. Try a different date, or we'll notify you
              the moment one opens up.
            </Text>
            <Button title="Choose a different date & time" onPress={() => router.back()} style={{ marginTop: 22, alignSelf: 'stretch' }} />
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
      {creators.length > 0 && (
        <View style={styles.footer}>
          <Button
            title="Set meeting point"
            arrow
            disabled={!canContinue}
            onPress={() => {
              // Mock mode previews the best match; API mode keeps null so
              // the server does the actual matching.
              if (auto) setDraft({ creatorId: serverCreators ? null : creators[0]?.id ?? null });
              router.push('/booking/summary');
            }}
            style={{ flex: 1 }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  lead: { fontSize: 14, color: colors.grey, lineHeight: 20, marginBottom: 14 },
  limitedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 13,
    marginBottom: 14,
  },
  limitedText: { flex: 1, fontSize: 12.5, color: '#8A7530', fontWeight: '600', lineHeight: 17 },
  autoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
  },
  autoCardActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  autoIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  autoSub: { fontSize: 12.5, color: colors.grey, marginTop: 2, lineHeight: 17 },
  autoCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 15, marginHorizontal: 2 },
  orLine: { flex: 1, height: 1, backgroundColor: '#ECEAE4' },
  orLabel: { fontSize: 11.5, fontWeight: '700', color: '#A0A0A0' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    position: 'relative',
  },
  cardActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  photo: { width: 58, height: 58, borderRadius: 14, overflow: 'hidden' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rating: { fontSize: 10.5, fontWeight: '800', color: colors.ink },
  reviews: { color: colors.greyWarm, fontWeight: '600' },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#EAF8F0',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  verifiedLabel: { fontSize: 9, fontWeight: '800', color: '#12784A', letterSpacing: 0.2 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  dist: { fontSize: 10, color: colors.greyWarm, fontWeight: '600' },
  why: { fontSize: 9.5, color: '#8A6800', fontWeight: '700', marginTop: 5, lineHeight: 13 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  tag: { backgroundColor: colors.segBgAlt, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  tagLabel: { fontSize: 9.5, fontWeight: '700', color: '#5C574E' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 9, alignSelf: 'flex-start' },
  previewLabel: { fontSize: 10, fontWeight: '800', color: colors.yellowDark },
  bestBadge: {
    position: 'absolute',
    top: 11,
    right: 12,
    backgroundColor: '#FFF1CC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
  },
  bestLabel: { fontSize: 8.5, fontWeight: '800', color: '#8A6800', letterSpacing: 0.4 },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyIcon: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFF4D6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  emptySub: { fontSize: 13.5, color: colors.grey, marginTop: 8, lineHeight: 20, textAlign: 'center' },
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
