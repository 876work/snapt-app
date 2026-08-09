import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { OccasionIcon } from '../../components/ui/Icons';
import { StateCard } from '../../components/home/StateCard';
import { FeaturedRail } from '../../components/home/FeaturedRail';
import { useAuth, useBookings } from '../../lib/store';
import { AREAS, Area, OCCASIONS, Occasion, PRICING_TABLE } from '../../lib/mock/data';
import { REMOTE_PACKAGES } from '../../lib/store/upload';
import { deriveHomeState, shouldShowEducation } from '../../lib/homeState';
import type { FeaturedCreator, SocialProof } from '../../lib/api';
import { formatMoney } from '../../lib/constants/business';
import { colors, insetTop } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';

/**
 * Entry prices: MIRROR values as the initial render, replaced by the live
 * config the moment it loads. The old module-load computation meant an
 * admin price change never reached this screen until an app update.
 */
const MIRROR_SESSION_FROM = Math.min(...Object.values(PRICING_TABLE.photo));
const MIRROR_REMOTE_FROM = Math.min(
  ...Object.values(REMOTE_PACKAGES).flatMap((tiers) => tiers.map((t) => t.priceUsd)),
);

export default function Home() {
  const router = useRouter();
  const { name, currency } = useAuth();
  const { resetDraft, setDraft } = useBookings();
  const bookings = useBookings((s) => s.bookings);
  const [mode, setMode] = React.useState<'in-person' | 'remote'>('in-person');
  const [occasion, setOccasion] = React.useState<Occasion | null>(null);
  const [area, setArea] = React.useState<Area | null>(null);
  const [areaOpen, setAreaOpen] = React.useState(false);
  // Trust-tile explainer sheets. These tiles used to navigate to pages that
  // didn't match their labels (Verified creators → the full legal document,
  // How matching works → the Help hub).
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [matchingOpen, setMatchingOpen] = React.useState(false);

  // What this user actually has going on. Pure derivation from the store's
  // bookings — see lib/homeState.ts for the precedence order.
  const homeState = React.useMemo(() => deriveHomeState(bookings), [bookings]);
  const showEducation = React.useMemo(() => shouldShowEducation(bookings), [bookings]);

  /**
   * The bell dot and the state card read the SAME source, so they can never
   * disagree: a dot with nothing on the screen to explain it was the old
   * behaviour (the dot was a hardcoded View that was always on).
   */
  const [unread, setUnread] = React.useState(0);
  const [proof, setProof] = React.useState<SocialProof | null>(null);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const startBooking = () => {
    resetDraft('in-person');
    setDraft({ occasion, area, type: 'in-person' });
    router.push('/booking/occasion');
  };

  // Featured creators. The SERVER decides who qualifies (published work
  // only) — an empty array here means "nobody yet", which the rail says
  // honestly rather than padding with avatar placeholders.
  const [featured, setFeatured] = React.useState<FeaturedCreator[] | null>(null);
  const [featuredLoading, setFeaturedLoading] = React.useState(true);
  const [featuredFailed, setFeaturedFailed] = React.useState(false);
  const [featuredReloadKey, setFeaturedReloadKey] = React.useState(0);

  // "From $X" prices — live config, mirror until it arrives.
  const [fromPrices, setFromPrices] = React.useState({
    session: MIRROR_SESSION_FROM,
    remote: MIRROR_REMOTE_FROM,
  });
  React.useEffect(() => {
    let cancelled = false;
    import('../../lib/api').then(({ apiConfigured, fetchPricingConfig }) => {
      if (!apiConfigured) return;
      fetchPricingConfig().then((c) => {
        if (cancelled || !c) return;
        const sessionVals = Object.values(c.pricingTable['photo'] ?? {});
        const remoteVals = Object.values(c.remoteTable).flatMap((t) => Object.values(t));
        setFromPrices({
          session: sessionVals.length ? Math.min(...sessionVals) : MIRROR_SESSION_FROM,
          remote: remoteVals.length ? Math.min(...remoteVals) : MIRROR_REMOTE_FROM,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    import('../../lib/api').then(async ({ apiConfigured, fetchFeaturedCreators }) => {
      if (!apiConfigured) {
        if (!cancelled) setFeaturedLoading(false);
        return;
      }
      const list = await fetchFeaturedCreators();
      if (cancelled) return;
      // null = fetch failed. `?? []` here used to make failure claim
      // "nobody exists yet" — an empty rail with total confidence.
      if (list == null) setFeaturedFailed(true);
      else setFeatured(list);
      setFeaturedLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [featuredReloadKey]);

  // Unread + social proof refresh on focus: Home is a tab and stays mounted,
  // so a mount-only fetch would show a stale dot for the whole session.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      import('../../lib/api').then(async ({ apiConfigured, fetchUnreadNotifications, fetchSocialProof }) => {
        if (!apiConfigured) return;
        const [count, p] = await Promise.all([
          fetchUnreadNotifications(),
          fetchSocialProof(area),
        ]);
        if (cancelled) return;
        setUnread(count ?? 0);
        setProof(p);
      });
      return () => {
        cancelled = true;
      };
    }, [area]),
  );

  return (
    <View style={styles.root}>
      {/* Status-bar scrim. The hero scrolls away under the clock, so content
          was colliding with the time (same class of bug as the Meeting Point
          header). A fixed band keeps the status bar readable at any offset. */}
      <View pointerEvents="none" style={styles.statusScrim} />
      <ScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
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
            {/* Currency is set in exactly two places — the signup step and
                Profile → Currency. It was also a header control here, which
                made a display preference compete with the bell for the
                header's attention. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable onPress={() => router.push('/inbox')} style={styles.bellBtn}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                  <Path d="M10 19a2 2 0 004 0" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                </Svg>
                {unread > 0 && <View style={styles.bellDot} />}
              </Pressable>
            </View>
          </View>
          <Text style={styles.headline}>Be in the moment.{'\n'}We've got the rest.</Text>
        </View>

        {/* Overlapping content */}
        <View style={styles.content}>
          {/* What's happening with MY stuff — above the search card whenever
              there is anything personal to say. */}
          <StateCard state={homeState} />

          {/* Booking card */}
          <View style={styles.bookCard}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardLabel, { marginBottom: 0 }]}>In person or remote?</Text>
              {/* From the real pricing table, not a hardcoded string. */}
              <Text style={styles.fromPrice}>
                Sessions from {formatMoney(fromPrices.session, currency)}
              </Text>
            </View>
            <Text style={styles.pricingClaim}>Standard pricing. No haggling.</Text>
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
                <View style={[styles.cardHead, { marginTop: 14, marginBottom: 10 }]}>
                  <Text style={[styles.cardLabel, { marginBottom: 0 }]}>What's the moment?</Text>
                  <Text style={styles.optional}>Optional</Text>
                </View>
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
                    {area ?? 'Choose your area (optional)'}
                  </Text>
                  <Svg width={11} height={7} viewBox="0 0 12 8" fill="none">
                    <Path d="M1 1.5L6 6.5L11 1.5" stroke={colors.greyLight} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </Pressable>
                <Text style={styles.regionNote}>Currently serving northern Saint Lucia.</Text>
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

          {/* Trust row — every claim is now tappable to something real.
              Three static, unevidenced assertions were taking prime space on
              a marketplace nobody has used yet. */}
          <View style={styles.features}>
            <Feature
              onPress={() => setVerifyOpen(true)}
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 3l7 2.5v5.6c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.5L12 3z" stroke="#E0A400" strokeWidth={1.7} strokeLinejoin="round" />
                  <Path d="M9 12l2 2 4-4" stroke="#E0A400" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              }
              title="Verified creators"
              sub="How we vet"
            />
            <View style={styles.featureDiv} />
            <Feature
              onPress={() => setMatchingOpen(true)}
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Path d="M13 3L5 13h6l-1 8 8-11h-6l1-7z" stroke="#E0A400" strokeWidth={1.7} strokeLinejoin="round" />
                </Svg>
              }
              title="How matching works"
              sub="Find out"
            />
            <View style={styles.featureDiv} />
            <Feature
              onPress={() => router.push('/upload')}
              icon={
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Rect x="3.5" y="5" width="17" height="14" rx="3" stroke="#E0A400" strokeWidth={1.7} />
                  <Path d="M10 9.5l4.5 2.5L10 14.5v-5z" fill="#E0A400" />
                </Svg>
              }
              title="Edited content"
              sub={`From ${formatMoney(fromPrices.remote, currency)}`}
            />
          </View>

          {/* Remote edit as a real product, not a toggle label. Someone with
              200 photos on their phone has no idea we solve that. */}
          <Pressable onPress={() => router.push('/upload')} style={styles.remoteCard}>
            <View style={styles.remoteIcon}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path d="M6.5 18a4 4 0 01-.5-7.97A5.5 5.5 0 0117 9.5a3.5 3.5 0 011 6.9" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M12 12v6M9.5 14.2L12 11.7l2.5 2.5" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.remoteTitle}>Already have footage?</Text>
              <Text style={styles.remoteSub}>
                Get it professionally edited, from {formatMoney(fromPrices.remote, currency)}. No shoot needed.
              </Text>
            </View>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>

          {/* Social proof. Real counts only — the SERVER applies the
              threshold, so this cannot render a zero or an invented number. */}
          {proof && (
            <View style={styles.proofRow}>
              <View style={styles.proofDot} />
              <Text style={styles.proofText}>
                {proof.count} bookings in the last 30 days
                {proof.area ? ` in ${proof.area}` : ''}
              </Text>
            </View>
          )}

          {featuredFailed ? (
            <Pressable
              onPress={() => {
                setFeaturedFailed(false);
                setFeaturedLoading(true);
                setFeaturedReloadKey((k) => k + 1);
              }}
              style={styles.railFailed}
            >
              <Text style={styles.railFailedText}>
                Couldn't load featured creators — tap to retry.
              </Text>
            </Pressable>
          ) : (
            <FeaturedRail creators={featured} loading={featuredLoading} />
          )}

          {/* Education, until it stops being education. Dropped entirely
              once the user has completed a booking — a screen that keeps
              re-explaining itself to someone who has already done it reads
              as unfinished. */}
          {showEducation && (
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
          )}
        </View>
      </ScrollView>

      {/* WHAT VERIFIED MEANS. Copy is deliberately limited to what we DO:
          Didit government-ID verification, the 18+ check, and portfolio
          review. Background checks are NOT claimed — the police certificate
          of character is labelled coming soon. Trust & Safety was corrected
          once for overclaiming exactly this; don't reintroduce it here. */}
      <ExplainerSheet open={verifyOpen} onClose={() => setVerifyOpen(false)} title="How we vet creators">
        <ExplainerRow
          title="Government ID, verified"
          body="Every creator verifies a government-issued ID through Didit, our identity partner, with a live face match against the document."
        />
        <ExplainerRow
          title="18 or older"
          body="Age is checked from the verified document itself — never a typed-in birthday."
        />
        <ExplainerRow
          title="Portfolio reviewed"
          body="A real person reviews every creator's work and profile before they can take bookings."
        />
        <ExplainerRow
          title="Police certificate of character"
          body="Coming soon — we're building local certificate checks into creator vetting."
          soon
        />
        <Pressable
          onPress={() => {
            setVerifyOpen(false);
            router.push('/legal/trust-safety');
          }}
        >
          <Text style={styles.sheetLink}>Read the full Trust & Safety policy →</Text>
        </Pressable>
      </ExplainerSheet>

      <ExplainerSheet open={matchingOpen} onClose={() => setMatchingOpen(false)} title="How matching works">
        <ExplainerRow
          title="Real availability"
          body="You only see dates and times creators have actually opened — no requests into the void."
        />
        <ExplainerRow
          title="Your area"
          body="Matching covers our northern Saint Lucia service area — pick a spot and we only offer creators who cover it."
        />
        <ExplainerRow
          title="Specialties are a hard filter"
          body="Booking a wedding? You'll only ever be matched with creators who shoot weddings. Same for every occasion."
        />
        <ExplainerRow
          title="Pick, or let us match"
          body='Choose a specific creator from the list, or tap "Match me automatically" and the best available creator for your occasion, time and area takes the job.'
        />
      </ExplainerSheet>
    </View>
  );
}

function ExplainerSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
          <Pressable onPress={onClose} style={styles.sheetClose}>
            <Text style={styles.sheetCloseLabel}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ExplainerRow({ title, body, soon }: { title: string; body: string; soon?: boolean }) {
  return (
    <View style={styles.expRow}>
      <View style={styles.expRowHead}>
        <Text style={styles.expRowTitle}>{title}</Text>
        {soon && (
          <View style={styles.soonChip}>
            <Text style={styles.soonChipLabel}>COMING SOON</Text>
          </View>
        )}
      </View>
      <Text style={styles.expRowBody}>{body}</Text>
    </View>
  );
}

function Feature({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.feature}>
      {icon}
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureSub}>{sub}</Text>
      </View>
    </Pressable>
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
  statusScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: insetTop,
    backgroundColor: colors.yellow,
    zIndex: 5,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fromPrice: { fontSize: 11.5, fontWeight: '800', color: colors.yellowDark },
  pricingClaim: { fontSize: 10.5, color: colors.greyWarm, marginTop: 3, marginBottom: 9 },
  optional: { fontSize: 10, fontWeight: '700', color: colors.greyLight },
  regionNote: { fontSize: 10.5, color: colors.greyWarm, marginTop: 7, marginHorizontal: 2 },
  remoteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 14,
  },
  remoteIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  remoteSub: { fontSize: 12, color: colors.grey, lineHeight: 17, marginTop: 2 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, paddingHorizontal: 4 },
  proofDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1EC46F' },
  proofText: { fontSize: 11.5, fontWeight: '600', color: colors.greyWarm },
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
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: 34,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8D8', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, marginBottom: 14 },
  sheetLink: { fontSize: 13.5, fontWeight: '800', color: colors.yellowDark, marginTop: 14 },
  sheetClose: { alignSelf: 'center', marginTop: 18, paddingHorizontal: 26, paddingVertical: 11, borderRadius: 999, backgroundColor: '#F1EEE7' },
  sheetCloseLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  expRow: { marginBottom: 13 },
  expRowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expRowTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  expRowBody: { fontSize: 13, color: colors.grey, lineHeight: 19, marginTop: 3 },
  soonChip: { backgroundColor: '#FFF4D6', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2.5 },
  soonChipLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: '#8A6800' },
  railFailed: { marginHorizontal: 20, marginTop: 6, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#F1EEE7' },
  railFailedText: { fontSize: 12.5, color: colors.grey, textAlign: 'center' },
  featureSub: { fontSize: 9.5, color: colors.greyWarm, marginTop: 2, textAlign: 'center' },
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
});
