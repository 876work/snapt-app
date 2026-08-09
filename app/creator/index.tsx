import React from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SlideToConfirm } from '../../components/ui/SlideToConfirm';
import { PushOfferNudge } from '../../components/creator/PushOfferNudge';
import { HeadshotNudge } from '../../components/creator/HeadshotNudge';
import { useAuth } from '../../lib/store';
import { JobOffer, useCreator } from '../../lib/store/creator';
import {
  apiConfigured,
  fetchMyBookings,
  fetchMyDeliveries,
  type DeliveryStatus,
  type ServerBookingListItem,
} from '../../lib/api';
import { CREATOR_PLATFORM_FEE_RATE, formatMoney } from '../../lib/constants/business';
import { colors, insetTop, insetBottom } from '../../lib/theme';
import { navShrinkOnScroll } from '../../lib/navShrink';
import { bookingToOffer, JOB_STATUSES, stageForStatus } from '../../lib/creatorJobs';

export default function CreatorHome() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const name = useAuth((s) => s.name);
  const { available, toggleAvailable, setAvailable, offers, jobStages, declineOffer, setOffers, setStage } =
    useCreator();

  // Availability is a real matching gate server-side: hydrate on mount,
  // persist every flip (optimistic; server re-read corrects drift).
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) return;
      fetchCreatorMe().then((me) => {
        if (me && typeof me.is_available === 'boolean') setAvailable(me.is_available);
      });
    });
  }, [setAvailable]);

  const [wentAvailable, setWentAvailable] = React.useState(false);
  const onToggleAvailable = () => {
    const next = !available;
    toggleAvailable();
    if (!available) setWentAvailable(true); // they just went ON
    import('../../lib/api').then(({ apiConfigured, updateCreatorSettingsApi }) => {
      if (!apiConfigured) return;
      updateCreatorSettingsApi({ is_available: next }).then((r) => {
        if (!r || 'error' in r) setAvailable(!next); // revert on failure
      });
    });
  };
  const openOffers = offers.filter((o) => !jobStages[o.id] || jobStages[o.id] === 'offer');

  // API mode: real bookings replace the mock list. Pending-assigned rows are
  // live OFFERS (15-min accept window, countdown from offer_expires_at);
  // confirmed rows are accepted jobs.
  // Raw rows kept alongside the offer cards: scheduled_at is what decides
  // "today" versus "upcoming", and bookingToOffer flattens it into a string.
  const [serverBookings, setServerBookings] = React.useState<ServerBookingListItem[]>([]);
  const [jobsFailed, setJobsFailed] = React.useState(false);
  const [jobsLoading, setJobsLoading] = React.useState(apiConfigured);
  const reloadJobs = React.useCallback(() => {
    if (!apiConfigured) return;
    fetchMyBookings().then((bookings) => {
      setJobsLoading(false);
      if (!bookings) { setJobsFailed(true); return; }
      const mine = bookings.filter((b) => JOB_STATUSES.includes(b.status));
      // Shared with the job detail screen so a deep-linked offer renders
      // identically to one opened from this list.
      const jobs: JobOffer[] = mine.map(bookingToOffer);
      setServerBookings(mine);
      setOffers(jobs);
      for (const b of mine) setStage(b.id, stageForStatus(b.status));
    });
  }, [setOffers, setStage]);
  React.useEffect(() => { reloadJobs(); }, [reloadJobs]);

  /**
   * THE DELIVERY CLOCK — the creator's own copy of what the admin Today
   * screen sees. Until now nothing told a creator they were late; the first
   * person who knew was an admin looking at a portal the creator cannot open.
   *
   * Its own three states, kept separate from the offers fetch: a failed
   * deliveries call must never render as "nothing overdue", which is exactly
   * the reassuring lie that costs someone their rush deadline.
   */
  const [deliveries, setDeliveries] = React.useState<{ late: DeliveryStatus[]; approaching: DeliveryStatus[] } | null>(null);
  const [devLoading, setDevLoading] = React.useState(true);
  const [devFailed, setDevFailed] = React.useState(false);
  const loadDeliveries = React.useCallback(async () => {
    if (!apiConfigured) { setDevLoading(false); return; }
    setDevLoading(true);
    setDevFailed(false);
    const d = await fetchMyDeliveries();
    if (!d) { setDevFailed(true); setDevLoading(false); return; }
    setDeliveries(d);
    setDevLoading(false);
  }, []);
  React.useEffect(() => { loadDeliveries(); }, [loadDeliveries]);

  /**
   * REAL earnings. This strip showed formatMoney(95.2) and formatMoney(438.6)
   * — two invented numbers, shown to a creator about their own money, in the
   * one place they would trust without checking. Now the same totals the
   * Earnings screen reads, or nothing at all if the call fails: a made-up
   * balance is worse than no balance.
   */
  const [earnings, setEarnings] = React.useState<{ pending: number; available: number } | null>(null);
  const [earnFailed, setEarnFailed] = React.useState(false);
  React.useEffect(() => {
    if (!apiConfigured) return;
    import('../../lib/api').then(({ fetchEarnings }) =>
      fetchEarnings().then((d) => (d ? setEarnings(d.totals) : setEarnFailed(true))),
    );
  }, []);

  // Accepted, not-yet-finished jobs, split by whether they are TODAY.
  const acceptedJobs = offers.filter((o) => jobStages[o.id] && jobStages[o.id] !== 'offer');
  const isToday = (o: JobOffer) => {
    const b = serverBookings.find((x) => x.id === o.id);
    if (!b?.scheduled_at) return false;
    const d = new Date(b.scheduled_at);
    const t = new Date();
    return d.toDateString() === t.toDateString();
  };
  const todayJobs = acceptedJobs.filter(isToday);
  const upcomingJobs = acceptedJobs
    .filter((o) => !isToday(o))
    .filter((o) => {
      const b = serverBookings.find((x) => x.id === o.id);
      return b?.scheduled_at ? new Date(b.scheduled_at).getTime() > Date.now() : true;
    })
    .sort((a, b) => {
      const ax = serverBookings.find((x) => x.id === a.id)?.scheduled_at ?? '';
      const bx = serverBookings.find((x) => x.id === b.id)?.scheduled_at ?? '';
      return ax.localeCompare(bx);
    });

  const dueLabel = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  };
  const lateFor = (h: number) => (h < 1 ? 'less than an hour' : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`);

  // Live tick for offer countdowns; expired offers drop off the list (the
  // server reassigns them on its own via the lazy sweep).
  const [now, setNow] = React.useState(Date.now());
  const hasLiveOffers = offers.some((o) => o.expiresAt);
  React.useEffect(() => {
    if (!hasLiveOffers) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasLiveOffers]);

  const ticking = (iso: string) => {
    const ms = Math.max(0, Date.parse(iso) - now);
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Expired offers disappear as the clock hits zero.
  const liveOffers = openOffers.filter((o) => !o.expiresAt || Date.parse(o.expiresAt) > now);

  // §14 forced re-consent: material changes to the Creator Agreement /
  // Background Check Disclosure must be re-accepted, not silently applied.
  const [reconsent, setReconsent] = React.useState<{ doc_type: string; title: string } | null>(null);
  React.useEffect(() => {
    if (!apiConfigured) return;
    import('../../lib/api').then(({ fetchReconsentNeeded }) =>
      fetchReconsentNeeded().then((n) => setReconsent(n?.[0] ?? null)),
    );
  }, []);
  const acceptReconsent = async () => {
    if (!reconsent) return;
    const { reconsentApi, fetchReconsentNeeded } = await import('../../lib/api');
    await reconsentApi(reconsent.doc_type);
    const n = await fetchReconsentNeeded();
    setReconsent(n?.[0] ?? null);
  };

  // Declining is irreversible (the offer reassigns server-side), so it goes
  // through a slide-to-confirm sheet rather than a bare tap.
  const [declineTarget, setDeclineTarget] = React.useState<JobOffer | null>(null);
  const confirmDecline = async () => {
    if (!declineTarget) return false;
    if (apiConfigured) {
      const { declineBookingApi } = await import('../../lib/api');
      await declineBookingApi(declineTarget.id); // reassigns server-side, no strike
    }
    declineOffer(declineTarget.id);
    setDeclineTarget(null);
    return true;
  };

  return (
    <View style={styles.root}>
      {/* Dark header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={styles.headerMode}>Creator mode</Text>
            <Text style={styles.headerName}>{name || 'Creator'}</Text>
          </View>
          <View style={styles.headerAvatar}>
            <Image
              source={require('../../assets/design/creators/jordan.webp')}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </View>
        </View>
        <View style={styles.availCard}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={[styles.availDot, { backgroundColor: available ? '#1EC46F' : '#8A8377' }]} />
            <View style={{ minWidth: 0 }}>
              <Text style={styles.availLabel}>{available ? "You're available" : "You're offline"}</Text>
              <Text style={styles.availSub}>
                {available ? 'Receiving job offers near you' : 'Not receiving job offers'}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onToggleAvailable}
            style={[styles.switchTrack, available && styles.switchTrackOn]}
          >
            <View style={[styles.switchKnob, available && styles.switchKnobOn]} />
          </Pressable>
        </View>
      </View>

      <ScrollView onScroll={navShrinkOnScroll} scrollEventThrottle={32} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Contextual, once-each push re-prompt: on first seeing the approved
            dashboard, and again the moment they first go available — the two
            points where a 15-minute offer window makes push obviously worth
            having. The component self-hides when push already delivers. */}
        <PushOfferNudge trigger={wentAvailable ? 'available' : 'approved'} />
        {/* Approved creators without a live headshot — the backfill path.
            Client-side they're an initial-letter tile until this is done. */}
        <HeadshotNudge />
        {reconsent && (
          <View style={{ backgroundColor: '#FFF4D6', borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <Text style={{ fontSize: 13.5, fontWeight: '800', color: colors.ink }}>
              {reconsent.title} has been updated
            </Text>
            <Text style={{ fontSize: 12, color: '#8A7530', marginTop: 4, lineHeight: 17 }}>
              A material change needs your acceptance before you take new bookings. Review it in
              Profile → Legal, then accept here.
            </Text>
            <Pressable onPress={acceptReconsent} style={{ backgroundColor: colors.ink, borderRadius: 10, height: 40, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>I've reviewed — accept</Text>
            </Pressable>
          </View>
        )}
        {/* OVERDUE — first, always. Money and a broken promise are attached
            to these, and a creator must never learn they are late from us
            after the client has already noticed. */}
        {devFailed && (
          <Pressable onPress={loadDeliveries} style={styles.clockFailCard}>
            <Text style={styles.clockFailTitle}>Couldn't check your delivery deadlines</Text>
            <Text style={styles.clockFailSub}>
              Tap to retry — this is not a confirmation that nothing is due.
            </Text>
          </Pressable>
        )}
        {!devFailed && !devLoading && (deliveries?.late.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Overdue</Text>
            {deliveries!.late.map((d) => (
              <Pressable
                key={d.booking_id}
                onPress={() => router.push(`/creator/job/${d.booking_id}`)}
                style={styles.lateCard}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.lateTitle}>
                    {d.occasion ? `${d.occasion} session` : 'Remote edit order'}
                    {d.rush ? ' · RUSH' : ''}
                  </Text>
                  <Text style={styles.lateDue}>Was due {dueLabel(d.due_at)}</Text>
                  <Text style={styles.lateBy}>Late by {lateFor(d.hours_late)}</Text>
                </View>
                <Text style={styles.lateCta}>Upload ›</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* DUE SOON — same clock, same config as the client's estimate. */}
        {!devFailed && !devLoading && (deliveries?.approaching.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Due soon</Text>
            {deliveries!.approaching.map((d) => (
              <Pressable
                key={d.booking_id}
                onPress={() => router.push(`/creator/job/${d.booking_id}`)}
                style={styles.soonCard}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.soonTitle}>
                    {d.occasion ? `${d.occasion} session` : 'Remote edit order'}
                    {d.rush ? ' · RUSH' : ''}
                  </Text>
                  <Text style={styles.soonDue}>Due {dueLabel(d.due_at)}</Text>
                </View>
                <Text style={styles.soonCta}>Upload ›</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* NEEDS ACTION NOW — anything with a clock on it. Today's accepted
            session sits with the live offers because both are "before you put
            the phone down", which is the only grouping that matters here. */}
        {todayJobs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today</Text>
            {todayJobs.map((j) => (
              <Pressable
                key={j.id}
                onPress={() => router.push(`/creator/job/${j.id}`)}
                style={styles.todayCard}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.todayTitle}>{j.title}</Text>
                  <Text style={styles.todayMeta}>{j.when} · {j.loc}</Text>
                </View>
                <Text style={styles.todayCta}>Open ›</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.offersHead}>
          <Text style={styles.offersTitle}>
            {liveOffers.length > 0 ? 'Needs action now' : 'Job offers near you'}
          </Text>
          {available && <Text style={styles.live}>Live</Text>}
        </View>

        {jobsLoading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={colors.yellowDark} />
            <Text style={styles.emptySub}>Loading your jobs…</Text>
          </View>
        ) : jobsFailed ? (
          /* A failed fetch must never read as "no jobs" — that is the message
             that makes a creator stop opening the app. */
          <Pressable onPress={() => { setJobsFailed(false); setJobsLoading(true); reloadJobs(); }} style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn't load your jobs</Text>
            <Text style={styles.emptySub}>
              This is a connection problem, not an empty queue. Tap to try again.
            </Text>
          </Pressable>
        ) : available ? (
          liveOffers.length > 0 ? (
            <View style={{ gap: 12 }}>
              {liveOffers.map((j) => (
                <View key={j.id} style={[styles.jobCard, j.urgent && styles.jobCardUrgent]}>
                  <View style={styles.jobTopRow}>
                    <View style={[styles.jobBadge, j.type === 'remote' && { backgroundColor: '#EAFBFD' }]}>
                      <Text style={[styles.jobBadgeLabel, j.type === 'remote' && { color: '#3FA9BC' }]}>
                        {j.type === 'remote' ? 'REMOTE EDIT' : 'IN PERSON'}
                      </Text>
                    </View>
                    {/* Paid rush: hours, not a day — and it pays extra. */}
                    {j.rush && (
                      <View style={styles.rushBadge}>
                        <Text style={styles.rushBadgeLabel}>RUSH · PAYS EXTRA</Text>
                      </View>
                    )}
                    {j.urgent && (
                      <View style={styles.countdown}>
                        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                          <Circle cx="12" cy="13" r="8" stroke="#C0392B" strokeWidth={2} />
                          <Path d="M12 9v4l2.5 2M9 2.5h6" stroke="#C0392B" strokeWidth={2} strokeLinecap="round" />
                        </Svg>
                        <Text style={styles.countdownLabel}>
                          Expires in {j.expiresAt ? ticking(j.expiresAt) : j.countdown}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ minWidth: 0 }}>
                      <Text style={styles.jobTitle}>{j.title}</Text>
                      <Text style={styles.jobOccasion}>{j.occasion}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.jobPay}>{formatMoney(j.payUsd, currency)}</Text>
                      <Text style={styles.jobPaySub}>your take</Text>
                    </View>
                  </View>
                  <View style={styles.jobMetaRow}>
                    <View style={styles.jobMeta}>
                      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.grey} strokeWidth={1.8} />
                        <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
                      </Svg>
                      <Text style={styles.jobMetaLabel}>{j.when}</Text>
                    </View>
                    <View style={styles.jobMeta}>
                      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
                        <Circle cx="12" cy="10" r="2.3" stroke={colors.grey} strokeWidth={1.8} />
                      </Svg>
                      <Text style={styles.jobMetaLabel}>{j.loc}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                    <Pressable onPress={() => setDeclineTarget(j)} style={styles.declineBtn}>
                      <Text style={styles.declineLabel}>Decline</Text>
                    </Pressable>
                    <Pressable onPress={() => router.push(`/creator/job/${j.id}`)} style={styles.acceptBtn}>
                      <Text style={styles.acceptLabel}>View & accept</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 8a6 6 0 10-12 0c0 7-2.5 9-2.5 9h17S18 15 18 8z" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinejoin="round" />
                  <Path d="M10 20.5a2.2 2.2 0 004 0" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
                </Svg>
              </View>
              <Text style={styles.emptyTitle}>You're set up and visible</Text>
              <Text style={styles.emptySub}>
                Nothing to do right now — here's how work reaches you.
              </Text>
              <View style={styles.howList}>
                <Text style={styles.howItem}>
                  <Text style={styles.howNum}>1  </Text>
                  A client books a session in your area, for something you shoot.
                </Text>
                <Text style={styles.howItem}>
                  <Text style={styles.howNum}>2  </Text>
                  We offer it to a matching creator who's available. You get a push with a
                  15-minute window to accept.
                </Text>
                <Text style={styles.howItem}>
                  <Text style={styles.howNum}>3  </Text>
                  Accept it and it moves into Today or Upcoming here.
                </Text>
              </View>
              <Text style={styles.howTip}>
                More offers reach you with availability on, more specialties selected, and a wider
                service radius — all in Profile.
              </Text>
              <View style={styles.availChip}>
                <View style={[styles.availDot, { backgroundColor: '#1EC46F' }]} />
                <Text style={styles.availChipLabel}>Availability is on</Text>
              </View>
            </View>
          )
        ) : (
          <View style={styles.emptyCard}>
            <View style={[styles.emptyIcon, { backgroundColor: '#F1EEE7' }]}>
              <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke="#B4B1AA" strokeWidth={1.8} />
                <Path d="M8 12h8" stroke="#B4B1AA" strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </View>
            <Text style={styles.emptyTitle}>You're offline</Text>
            <Text style={styles.emptySub}>Turn on availability above to start receiving job offers near you.</Text>
          </View>
        )}
        {/* UPCOMING — confirmed work in date order, after everything urgent. */}
        {upcomingJobs.length > 0 && (
          <View style={[styles.section, { marginTop: 22 }]}>
            <Text style={styles.sectionTitle}>Upcoming</Text>
            {upcomingJobs.map((j) => (
              <Pressable
                key={j.id}
                onPress={() => router.push(`/creator/job/${j.id}`)}
                style={styles.upcomingCard}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.upcomingTitle}>{j.title}</Text>
                  <Text style={styles.upcomingMeta}>{j.when} · {j.loc}</Text>
                </View>
                <Text style={styles.upcomingPay}>{formatMoney(j.payUsd, currency)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* EARNINGS — quiet, at the foot, and REAL. Hidden entirely if the
            figures could not be fetched: no number beats a wrong one. */}
        {earnings && !earnFailed && (
          <Pressable onPress={() => router.push('/creator/earnings')} style={styles.earnCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.earnLabel}>Pending</Text>
              <Text style={styles.earnValue}>{formatMoney(earnings.pending, currency)}</Text>
            </View>
            <View style={styles.earnDiv} />
            <View style={{ flex: 1 }}>
              <Text style={styles.earnLabel}>Available</Text>
              <Text style={styles.earnValue}>{formatMoney(earnings.available, currency)}</Text>
            </View>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        )}
        <View style={{ height: 130 }} />
      </ScrollView>

      {/* Decline confirmation — slide-to-confirm (offer reassigns, can't undo) */}
      <Modal
        visible={declineTarget != null}
        transparent
        animationType="slide"
        onRequestClose={() => setDeclineTarget(null)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setDeclineTarget(null)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Decline this job?</Text>
            <Text style={styles.sheetSub}>
              {declineTarget?.title ?? 'This job'} goes back into matching for another creator.
              Declining before accepting carries no strike, but you can't get the offer back.
            </Text>
            <View style={{ marginTop: 18 }}>
              <SlideToConfirm label="Slide to decline this job" onConfirm={confirmDecline} />
            </View>
            <Pressable onPress={() => setDeclineTarget(null)} style={styles.sheetKeepBtn}>
              <Text style={styles.sheetKeepLabel}>Keep the offer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  howList: { gap: 9, marginTop: 12, alignSelf: 'stretch' },
  howItem: { fontSize: 13, color: '#5C574E', lineHeight: 19 },
  howNum: { fontWeight: '800', color: colors.yellowDark },
  howTip: { fontSize: 12.5, color: colors.grey, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  todayCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.ink, borderRadius: 14, padding: 15, marginBottom: 9,
  },
  todayTitle: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
  todayMeta: { fontSize: 12.5, color: 'rgba(255,255,255,0.72)', marginTop: 3 },
  todayCta: { fontSize: 13, fontWeight: '800', color: colors.yellow },
  upcomingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 15, marginBottom: 9,
    shadowColor: colors.ink, shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  upcomingTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  upcomingMeta: { fontSize: 12.5, color: colors.grey, marginTop: 3 },
  upcomingPay: { fontSize: 14, fontWeight: '800', color: colors.ink },
  sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: '#8A8377', marginBottom: 9 },
  lateCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FDECEA', borderWidth: 1, borderColor: '#F3C0B8',
    borderRadius: 14, padding: 15, marginBottom: 9,
  },
  lateTitle: { fontSize: 14.5, fontWeight: '800', color: '#8C2B1B' },
  lateDue: { fontSize: 12.5, color: '#A6503E', marginTop: 3 },
  lateBy: { fontSize: 12.5, fontWeight: '800', color: '#8C2B1B', marginTop: 2 },
  lateCta: { fontSize: 13, fontWeight: '800', color: '#8C2B1B' },
  soonCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.yellowSoft, borderWidth: 1, borderColor: colors.yellowSoftBorder,
    borderRadius: 14, padding: 15, marginBottom: 9,
  },
  soonTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  soonDue: { fontSize: 12.5, color: '#6E5B23', marginTop: 3 },
  soonCta: { fontSize: 13, fontWeight: '800', color: '#8A6800' },
  clockFailCard: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#F3C0B8',
    borderRadius: 14, padding: 14, marginBottom: 16,
  },
  clockFailTitle: { fontSize: 13.5, fontWeight: '800', color: '#8C2B1B' },
  clockFailSub: { fontSize: 12.5, color: colors.grey, marginTop: 3, lineHeight: 17 },
  rushBadge: { backgroundColor: '#FFE9E4', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  rushBadgeLabel: { fontSize: 9, fontWeight: '800', color: '#C0392B', letterSpacing: 0.4 },
  root: { flex: 1, backgroundColor: colors.offWhite },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: Math.max(insetBottom + 12, 30),
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8D8', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  sheetSub: { fontSize: 13, color: colors.grey, lineHeight: 19, marginTop: 8 },
  sheetKeepBtn: {
    height: 50,
    borderRadius: 15,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  sheetKeepLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  header: {
    backgroundColor: colors.ink,
    paddingTop: insetTop + 17,
    paddingHorizontal: 22,
    paddingBottom: 22,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerMode: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  headerName: { fontSize: 18, fontWeight: '800', letterSpacing: -0.35, color: '#fff', marginTop: 2 },
  headerAvatar: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)' },
  availCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 15,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  availDot: { width: 10, height: 10, borderRadius: 5 },
  availLabel: { fontSize: 15, fontWeight: '800', color: '#fff' },
  availSub: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  switchTrack: {
    width: 48,
    height: 29,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.yellow },
  switchKnob: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  switchKnobOn: { alignSelf: 'flex-end' },
  body: { paddingHorizontal: 22, paddingTop: 20 },
  earnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    paddingHorizontal: 20,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  earnLabel: { fontSize: 10.5, color: colors.greyWarm, fontWeight: '600' },
  earnValue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.ink, marginTop: 2 },
  earnDiv: { width: 1, height: 38, backgroundColor: '#EEECE6' },
  offersHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 12,
  },
  offersTitle: { fontSize: 13, fontWeight: '800', letterSpacing: -0.25, color: colors.ink },
  live: { fontSize: 12.5, fontWeight: '700', color: '#1E9E5A' },
  jobCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  jobCardUrgent: { borderWidth: 1.5, borderColor: '#F2E3B8' },
  jobTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  jobBadge: { backgroundColor: '#FFF1CC', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  jobBadgeLabel: { fontSize: 8.5, fontWeight: '800', color: '#8A6800', letterSpacing: 0.4 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  countdownLabel: { fontSize: 10.5, fontWeight: '800', color: '#C0392B', fontVariant: ['tabular-nums'] },
  jobTitle: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  jobOccasion: { fontSize: 11, color: colors.greyWarm, marginTop: 2 },
  jobPay: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  jobPaySub: { fontSize: 11, color: colors.grey, marginTop: 1 },
  jobMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
  jobMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobMetaLabel: { fontSize: 10.5, color: colors.greyWarm },
  declineBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineLabel: { fontSize: 12.5, fontWeight: '700', color: colors.grey },
  acceptBtn: {
    flex: 2,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 36,
    paddingHorizontal: 26,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF6E0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  emptySub: {
    fontSize: 11,
    color: colors.greyWarm,
    marginTop: 7,
    lineHeight: 16,
    textAlign: 'center',
    maxWidth: 250,
  },
  availChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#EAF8F0',
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 13,
    marginTop: 16,
  },
  availChipLabel: { fontSize: 12.5, fontWeight: '700', color: '#1E9E5A' },
});
