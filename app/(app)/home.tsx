import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { BoltIcon, OccasionIcon } from '../../components/ui/Icons';
import { QuickBookSheet } from '../../components/home/QuickBookSheet';
import { useAuth, useBookings } from '../../lib/store';
import { AREAS, Area, CREATORS, OCCASIONS, Occasion } from '../../lib/mock/data';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { colors, insetTop } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';

export default function Home() {
  const router = useRouter();
  const { name, currency, setCurrency } = useAuth();
  const { resetDraft, setDraft } = useBookings();
  const [mode, setMode] = React.useState<'in-person' | 'remote'>('in-person');
  const [occasion, setOccasion] = React.useState<Occasion | null>(null);
  const [area, setArea] = React.useState<Area | null>(null);
  const [areaOpen, setAreaOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const startBooking = () => {
    resetDraft('in-person');
    setDraft({ occasion, area, type: 'in-person' });
    router.push('/booking/occasion');
  };

  // Real approved creators in API mode (rating shows "New" until the
  // reviews system lands; initials until avatar upload exists). Mock
  // catalog only when no API is configured.
  const [featured, setFeatured] = React.useState(CREATORS.slice(0, 2));
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchFeaturedCreators }) => {
      if (!apiConfigured) return;
      fetchFeaturedCreators().then((list) => {
        if (list && list.length > 0) setFeatured(list.slice(0, 2));
      });
    });
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 106 }}>
        {/* Yellow hero header */}
        <View style={styles.hero}>
          <Image
            source={require('../../assets/design/hero-creator-crop.webp')}
            style={styles.heroImg}
            resizeMode="contain"
          />
          <View style={styles.heroTopRow}>
            <Text style={styles.greeting}>
              {greet}, {name || 'friend'} <Text style={{ fontSize: 13 }}>👋</Text>
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => setCurrency(currency === 'USD' ? 'XCD' : 'USD')}
                style={styles.currencyPill}
              >
                <Text style={styles.currencyLabel}>{currency}</Text>
                <Svg width={9} height={6} viewBox="0 0 9 6" fill="none">
                  <Path d="M1 1l3.5 3.5L8 1" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                </Svg>
              </Pressable>
              <Pressable onPress={() => router.push('/inbox')} style={styles.bellBtn}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                  <Path d="M10 19a2 2 0 004 0" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                </Svg>
                <View style={styles.bellDot} />
              </Pressable>
            </View>
          </View>
          <Text style={styles.headline}>Be in the moment.{'\n'}We've got the rest.</Text>
        </View>

        {/* Overlapping content */}
        <View style={styles.content}>
          {/* Booking card */}
          <View style={styles.bookCard}>
            <Text style={styles.cardLabel}>In person or remote?</Text>
            <View style={styles.segTrack}>
              {(
                [
                  ['in-person', 'In person'],
                  ['remote', 'Remote edit'],
                ] as const
              ).map(([v, label]) => (
                <Pressable key={v} onPress={() => setMode(v)} style={[styles.seg, mode === v && styles.segActive]}>
                  <Text style={[styles.segLabel, mode === v && styles.segLabelActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {mode === 'in-person' ? (
              <>
                <Text style={[styles.cardLabel, { marginTop: 14, marginBottom: 10 }]}>
                  What's the moment?
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginHorizontal: -15 }}
                  contentContainerStyle={{ paddingHorizontal: 15, gap: 8, paddingBottom: 4 }}
                >
                  {OCCASIONS.map((o) => {
                    const active = occasion === o;
                    return (
                      <Pressable
                        key={o}
                        onPress={() => setOccasion(o)}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <OccasionIcon occasion={o} />
                        <Text style={[styles.chipLabel, active && { color: '#fff' }]}>{o}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable onPress={() => setAreaOpen(!areaOpen)} style={styles.locRow}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                    <Circle cx="12" cy="10" r="2.3" stroke={colors.grey} strokeWidth={1.8} />
                  </Svg>
                  <Text style={[styles.locLabel, area && { color: colors.ink, fontWeight: '700' }]}>
                    {area ?? 'Choose your area'}
                  </Text>
                  <Svg width={11} height={7} viewBox="0 0 12 8" fill="none">
                    <Path d="M1 1.5L6 6.5L11 1.5" stroke={colors.greyLight} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Pressable>
                {areaOpen && (
                  <View style={styles.areaList}>
                    {AREAS.map((a) => (
                      <Pressable
                        key={a}
                        onPress={() => {
                          setArea(a);
                          setAreaOpen(false);
                        }}
                        style={styles.areaItem}
                      >
                        <Text style={[styles.areaItemLabel, a === area && { color: colors.yellowDark, fontWeight: '800' }]}>
                          {a}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <Pressable onPress={startBooking} style={styles.cta}>
                  <Text style={styles.ctaLabel}>Check availability</Text>
                  <View style={styles.ctaArrow}>
                    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.yellow} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </View>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.remoteNote}>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ marginTop: 1 }}>
                    <Path d="M6.5 18a4 4 0 01-.5-7.97A5.5 5.5 0 0117 9.5a3.5 3.5 0 011 6.9" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M12 12v6M9.5 14.2L12 11.7l2.5 2.5" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={styles.remoteNoteText}>
                    No shoot needed — send us footage you already have and a Snapt editor takes it from there.
                  </Text>
                </View>
                <Pressable onPress={() => router.push('/upload')} style={styles.cta}>
                  <Text style={styles.ctaLabel}>Upload footage</Text>
                  <View style={styles.ctaArrow}>
                    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.yellow} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </View>
                </Pressable>
              </>
            )}
          </View>

          {/* Features strip */}
          <View style={styles.features}>
            <Feature
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 3l7 2.5v5.6c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.5L12 3z" stroke="#E0A400" strokeWidth={1.7} strokeLinejoin="round" />
                  <Path d="M9 12l2 2 4-4" stroke="#E0A400" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              }
              title="Verified creators"
              sub="Quality you can trust"
            />
            <View style={styles.featureDiv} />
            <Feature
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Path d="M13 3L5 13h6l-1 8 8-11h-6l1-7z" stroke="#E0A400" strokeWidth={1.7} strokeLinejoin="round" />
                </Svg>
              }
              title="Fast responses"
              sub="Most reply in minutes"
            />
            <View style={styles.featureDiv} />
            <Feature
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Rect x="3.5" y="5" width="17" height="14" rx="3" stroke="#E0A400" strokeWidth={1.7} />
                  <Path d="M10 9.5l4.5 2.5L10 14.5v-5z" fill="#E0A400" />
                </Svg>
              }
              title="Edited content"
              sub="Available add-on"
            />
          </View>

          {/* Top creators */}
          <View style={styles.creatorsHead}>
            <Text style={styles.creatorsTitle}>Top creators near you</Text>
            <Pressable onPress={() => router.push('/creators')} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={styles.seeAll}>See all</Text>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
          </View>
          <View style={styles.creatorGrid}>
            {featured.map((c) => (
              <View key={c.id} style={styles.creatorCard}>
                <View style={[styles.creatorPhotoWrap, { backgroundColor: c.tint }]}>
                  <View style={styles.creatorPhoto}><CreatorAvatar name={c.name} photo={c.photo} /></View>
                  <View style={styles.ratingPill}>
                    <Svg width={11} height={11} viewBox="0 0 24 24" fill={colors.yellow}>
                      <Path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />
                    </Svg>
                    <Text style={styles.ratingText}>
                      {c.rating != null ? c.rating.toFixed(1) : 'New'}{c.rating != null && <Text style={styles.ratingReviews}> ({c.sessions})</Text>}
                    </Text>
                  </View>
                </View>
                <View style={styles.creatorBody}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={styles.creatorName}>{c.name}</Text>
                    {c.verified && (
                      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                        <Path d="M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15.7l.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.2L12 3z" fill={colors.yellow} />
                        <Path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    )}
                  </View>
                  <View style={styles.tagRow}>
                    {c.specialties.slice(0, 2).map((t) => (
                      <View key={t} style={styles.tag}>
                        <Text style={styles.tagLabel}>{t}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.creatorLocRow}>
                    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke="#8A8377" strokeWidth={1.8} strokeLinejoin="round" />
                      <Circle cx="12" cy="10" r="2.3" stroke="#8A8377" strokeWidth={1.8} />
                    </Svg>
                    <Text style={styles.creatorLoc}>{c.loc}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>

          {/* How it works */}
          <View style={styles.how}>
            <Text style={styles.howTitle}>How it works</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <HowStep
                n={1}
                title="Tell us what you need"
                sub="Book a creator to capture it live, or upload footage you've already got."
                icon={
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                    <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.ink} strokeWidth={1.8} />
                    <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                }
              />
              <View style={styles.howDash} />
              <HowStep
                n={2}
                title="We match or edit"
                sub="A vetted local creator is matched to your session, or your footage goes straight to editing."
                icon={
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                    <Circle cx="9" cy="9" r="3" stroke={colors.ink} strokeWidth={1.8} />
                    <Path d="M3.5 19c.9-2.7 3-4 5.5-4s4.6 1.3 5.5 4" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                    <Path d="M16 6.5a3 3 0 010 5.6M18 19c-.3-1.3-.9-2.4-1.7-3.2" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                }
              />
              <View style={styles.howDash} />
              <HowStep
                n={3}
                title="Get it delivered"
                sub="Your final photos or video land in the app, ready to download and share."
                icon={
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                    <Rect x="3.5" y="5" width="17" height="14" rx="3" stroke={colors.ink} strokeWidth={1.8} />
                    <Path d="M10 9.5l4.5 2.5L10 14.5v-5z" fill={colors.ink} />
                  </Svg>
                }
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Global FAB */}
      <Pressable onPress={() => setSheetOpen(true)} style={styles.fab}>
        <BoltIcon size={24} />
      </Pressable>
      <QuickBookSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

function Feature({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <View style={styles.feature}>
      {icon}
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureSub}>{sub}</Text>
      </View>
    </View>
  );
}

function HowStep({ n, title, sub, icon }: { n: number; title: string; sub: string; icon: React.ReactNode }) {
  return (
    <View style={styles.howStep}>
      <View style={{ width: 42, height: 42 }}>
        <View style={styles.howCircle}>{icon}</View>
        <View style={styles.howBadge}>
          <Text style={styles.howBadgeLabel}>{n}</Text>
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.howStepTitle}>{title}</Text>
        <Text style={styles.howStepSub}>{sub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  hero: {
    position: 'relative',
    backgroundColor: colors.yellow,
    paddingTop: insetTop + 17,
    paddingHorizontal: 22,
    paddingBottom: 154,
    overflow: 'hidden',
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
  },
  heroImg: { position: 'absolute', width: 220, height: 175, left: 151, top: 69 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 },
  greeting: { fontSize: 13, fontWeight: '800', letterSpacing: -0.2, color: '#fff' },
  currencyPill: {
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  currencyLabel: { fontSize: 11, fontWeight: '800', color: colors.ink },
  bellBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: '#F7A701',
  },
  headline: {
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 24,
    letterSpacing: -0.5,
    marginTop: 14,
    maxWidth: '66%',
    color: colors.ink,
    zIndex: 2,
  },
  content: { paddingHorizontal: 20, marginTop: -96 },
  bookCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    paddingHorizontal: 15,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardLabel: { fontSize: 13, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, marginBottom: 9 },
  segTrack: { flexDirection: 'row', gap: 5, backgroundColor: colors.segBg, borderRadius: 12, padding: 4 },
  seg: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segActive: {
    // CD design: the active segment is the black pill, not white.
    backgroundColor: colors.ink,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segLabel: { fontSize: 12.5, fontWeight: '600', color: colors.grey },
  segLabelActive: { color: '#fff', fontWeight: '800' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLabel: { fontSize: 11.5, fontWeight: '700', color: colors.ink },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 14,
    marginTop: 14,
  },
  locLabel: { flex: 1, fontSize: 12, fontWeight: '600', color: '#9A9A9A' },
  areaList: {
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 14,
    marginTop: 6,
    overflow: 'hidden',
  },
  areaItem: {
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  areaItemLabel: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  cta: {
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  ctaLabel: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
  ctaArrow: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 13,
    padding: 12,
    marginTop: 14,
  },
  remoteNoteText: { flex: 1, fontSize: 11, color: '#8A6800', lineHeight: 16, fontWeight: '600' },
  features: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 2,
    marginTop: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  feature: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  featureDiv: { width: 1, backgroundColor: '#F0EDE6', marginVertical: 3 },
  featureTitle: { fontSize: 10.5, fontWeight: '800', letterSpacing: -0.1, color: colors.ink, textAlign: 'center' },
  featureSub: { fontSize: 9.5, color: colors.greyWarm, marginTop: 2, textAlign: 'center' },
  creatorsHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 11,
    marginHorizontal: 2,
  },
  creatorsTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  seeAll: { fontSize: 12.5, fontWeight: '700', color: colors.yellowDark },
  creatorGrid: { flexDirection: 'row', gap: 12 },
  creatorCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  creatorPhotoWrap: { height: 148, position: 'relative' },
  creatorPhoto: { width: '100%', height: '100%' },
  ratingPill: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: { fontSize: 11, fontWeight: '800', color: colors.ink },
  ratingReviews: { color: colors.greyWarm, fontWeight: '600' },
  creatorBody: { paddingHorizontal: 11, paddingTop: 10, paddingBottom: 11 },
  creatorName: { fontSize: 12, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 7 },
  tag: { backgroundColor: colors.segBgAlt, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagLabel: { fontSize: 9.5, fontWeight: '600', color: '#5C574E' },
  creatorLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 9 },
  creatorLoc: { fontSize: 10, color: colors.greyWarm, fontWeight: '600' },
  how: {
    marginTop: 20,
    backgroundColor: '#FFF8E9',
    borderWidth: 1,
    borderColor: '#F3E6C4',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 17,
  },
  howTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, marginBottom: 14 },
  howStep: { flex: 1, alignItems: 'center', gap: 8 },
  howCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#F0E4C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  howBadge: {
    position: 'absolute',
    top: -5,
    left: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF8E9',
  },
  howBadgeLabel: { fontSize: 11, fontWeight: '800', color: colors.ink },
  howDash: { width: 20, borderTopWidth: 2, borderStyle: 'dashed', borderColor: '#E6D3A0', marginTop: 20 },
  howStepTitle: { fontSize: 9.5, fontWeight: '800', letterSpacing: -0.1, color: colors.ink, textAlign: 'center' },
  howStepSub: { fontSize: 9, color: colors.greyWarm, marginTop: 2, lineHeight: 12, textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 104,
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
