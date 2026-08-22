import React from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { safeBack } from '../../../lib/nav';
import { KeyboardScrollView } from '../../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Button } from '../../../components/ui/Button';
import { MeetingMap } from '../../../components/ui/MeetingMap';
import { SlideToConfirm } from '../../../components/ui/SlideToConfirm';
import { useAuth } from '../../../lib/store';
import { apiConfigured } from '../../../lib/api';
import { useCreator, JobStage } from '../../../lib/store/creator';
import { bookingToOffer, JOB_STATUSES } from '../../../lib/creatorJobs';
import { SocialPipeline } from '../../../components/creator/SocialPipeline';
import {
  OfferCountdownRing,
  URGENT_REMAINING_MS,
  formatRemaining,
} from '../../../components/creator/OfferCountdownRing';
import { RemoteJob } from '../../../components/creator/RemoteJob';
import { DeliverPanel, useUploadBatch } from '../../../components/creator/DeliverUploader';
import { formatMoney, NO_SHOW_GRACE_MINUTES } from '../../../lib/constants/business';
import { colors, insetBottom } from '../../../lib/theme';
import { haptic } from '../../../lib/haptics';

// Creator job flow: offer → accepted → on the way → check-in (safety code)
// → session in progress → footage upload → submitted.
const STAGE_TITLES: Record<JobStage, string> = {
  offer: 'Job offer',
  accepted: 'Job accepted',
  onway: 'On the way',
  checkin: 'Check in',
  session: 'Session in progress',
  upload: 'Upload footage',
  submitted: 'Footage submitted',
};

/** "Under 1 km" / "About 3.7 km" / "About 12 km" — approximate, and says so. */
function formatKm(km: number): string {
  if (km < 1) return 'Under 1 km';
  return `About ${km < 10 ? km.toFixed(1) : String(Math.round(km))} km`;
}

/**
 * Always HH:MM:SS. A session clock is read at a glance mid-shoot, so the
 * shape must never change under the creator — 00:09:12 stays the same width
 * as 01:09:12, and the digits never shift column as the hour rolls over.
 */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const sec = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

export default function CreatorJob() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useAuth((s) => s.currency);
  const { offers, jobStages, setStage } = useCreator();
  const job = offers.find((o) => o.id === id);
  const stage: JobStage = jobStages[String(id)] ?? 'offer';
  const [code, setCode] = React.useState('');
  const [contactConfirmed, setContactConfirmed] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  // Rush window hours from live config — the notice must promise the same
  // number the delivery clock enforces. Fallback matches the server default.
  const [rushHours, setRushHours] = React.useState(6);
  // Full offer window. Default mirrors the server's own (offers.ts, 15 min)
  // so the ring is sane before the config lands.
  const [offerWindowMs, setOfferWindowMs] = React.useState(15 * 60_000);
  React.useEffect(() => {
    import('../../../lib/api').then(({ apiConfigured: cfgd, fetchPricingConfig }) => {
      if (!cfgd) return;
      fetchPricingConfig().then((c) => {
        if (c) {
          setRushHours(c.rushHours);
          // The ring needs its 100%. Same already-public config key the
          // server stamps offer_expires_at from — no new endpoint.
          setOfferWindowMs(c.offerWindowMinutes * 60_000);
        }
      });
    });
  }, []);
  /**
   * OFFER COUNTDOWN — the deadline is the server's, never the device's.
   *
   * `expiresAt` is offer_expires_at exactly as the server stamped it when it
   * made this offer (offers.ts: now + offer_window_minutes, 15 by default).
   * The device clock only renders how much of that window is left; it never
   * decides where the window ends. An offer opened after its expiry computes
   * a non-positive remainder on the FIRST render, so it lands straight in
   * the expired state — never a live countdown.
   *
   * Each tick re-reads Date.now() rather than decrementing a counter, so a
   * backgrounded screen snaps to truth on return instead of having quietly
   * frozen mid-count.
   */
  const offerExpiresAtMs = React.useMemo(() => {
    if (!job?.expiresAt) return null;
    const parsed = Date.parse(job.expiresAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [job?.expiresAt]);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const offerRemainMs = offerExpiresAtMs != null ? offerExpiresAtMs - nowMs : null;
  /**
   * One warning as the window drops under two minutes — the same instant the
   * card turns red, for a creator who is not looking at the screen. Latched
   * by a ref so the 1s tick cannot fire it again every second, and never on
   * an offer that was ALREADY inside two minutes when it was opened: that is
   * not a threshold being crossed, it is where the offer started.
   */
  const urgentBuzzed = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (stage !== 'offer' || offerRemainMs == null || offerRemainMs <= 0) return;
    const urgent = offerRemainMs < URGENT_REMAINING_MS;
    if (urgentBuzzed.current === null) {
      urgentBuzzed.current = urgent; // first observation sets the baseline
      return;
    }
    if (urgent && !urgentBuzzed.current) {
      urgentBuzzed.current = true;
      haptic('warning');
    }
  }, [stage, offerRemainMs]);
  const offerExpired = stage === 'offer' && offerRemainMs != null && offerRemainMs <= 0;
  React.useEffect(() => {
    if (stage !== 'offer' || offerExpiresAtMs == null || offerExpired) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage, offerExpiresAtMs, offerExpired]);
  React.useEffect(() => {
    // The server sent an expiry the client cannot read — the countdown is
    // silently absent for this creator, which must not stay invisible.
    if (job?.expiresAt && offerExpiresAtMs == null) {
      import('../../../lib/sentry').then(({ captureHandledError }) =>
        captureHandledError(
          new Error(`unparseable offer_expires_at: ${job.expiresAt}`),
          'creator_job:offer_expiry_parse',
        ),
      );
    }
  }, [job?.expiresAt, offerExpiresAtMs]);

  /**
   * SESSION TIMER — both ends are the server's, neither is this screen's.
   *
   * Elapsed counts from `session_active_at`: the moment the server accepted
   * the safety code and the session legally began. That timestamp is written
   * by the server in the same call this screen's own "Verify code" action
   * makes, and is read back from GET /v1/bookings/:id/session — a route the
   * creator is explicitly authorised on (only `safety_code` is withheld from
   * them). Nothing here is captured at mount: a screen reopened an hour into
   * a session shows the true elapsed time, not one hour less.
   *
   * The polling exists for one narrow race — the local stage flips the
   * instant the verify call returns, so a slow write could leave
   * session_active_at briefly null. It stops the moment the value arrives.
   */
  const [sessionStartIso, setSessionStartIso] = React.useState<string | null>(null);
  const [sessionProbed, setSessionProbed] = React.useState(false);
  React.useEffect(() => {
    if (stage !== 'session' || !apiConfigured || sessionStartIso) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const { fetchSessionApi } = await import('../../../lib/api');
        const st = await fetchSessionApi(String(id));
        if (cancelled) return;
        if (st?.session_active_at) setSessionStartIso(st.session_active_at);
        setSessionProbed(true);
      } catch (err) {
        if (cancelled) return;
        setSessionProbed(true);
        // No elapsed count rather than a guessed one — but never in silence:
        // this failing means the creator is mid-shoot with no clock.
        const { captureHandledError } = await import('../../../lib/sentry');
        captureHandledError(err, 'creator_job:session_timer_fetch');
      }
    };
    load();
    timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [stage, id, sessionStartIso]);

  const sessionStartMs = React.useMemo(() => {
    if (!sessionStartIso) return null;
    const parsed = Date.parse(sessionStartIso);
    return Number.isFinite(parsed) ? parsed : null;
  }, [sessionStartIso]);
  React.useEffect(() => {
    if (sessionStartIso && sessionStartMs == null) {
      import('../../../lib/sentry').then(({ captureHandledError }) =>
        captureHandledError(
          new Error(`unparseable session_active_at: ${sessionStartIso}`),
          'creator_job:session_start_parse',
        ),
      );
    }
  }, [sessionStartIso, sessionStartMs]);

  /** Booked end = booked start + booked length, both as sold on the booking. */
  const bookedEndMs = React.useMemo(() => {
    const startIso = job?.scheduledAt;
    const hours = job?.durationHours;
    if (!startIso || hours == null || !Number.isFinite(hours)) return null;
    const start = Date.parse(startIso);
    return Number.isFinite(start) ? start + hours * 3_600_000 : null;
  }, [job?.scheduledAt, job?.durationHours]);

  // A tick of its own, deliberately separate from the offer countdown's:
  // the two clocks run at different stages and must not share a lifetime.
  const [sessionNowMs, setSessionNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (stage !== 'session') return;
    setSessionNowMs(Date.now());
    const t = setInterval(() => setSessionNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

    /**
   * DISTANCE — from STORED data only, never live GPS (no location permission
   * exists in this build, and this screen must not become the reason one
   * does). The creator's base_area name (their own profile) is matched
   * against the service-area centres; haversine from that centre to the
   * meeting pin. Any gap in the chain — no pin, no base_area, name not in
   * the list, fetch failed — means NO distance line at all: an absent figure
   * is honest, a defaulted one is wrong somewhere real.
   */
  const [distanceFromBase, setDistanceFromBase] = React.useState<{ km: number; from: string } | null>(null);
  const meetingLat = job?.meetingLat;
  const meetingLng = job?.meetingLng;
  React.useEffect(() => {
    if (stage !== 'offer' || job?.type !== 'in-person' || meetingLat == null || meetingLng == null) return;
    let cancelled = false;
    (async () => {
      try {
        const api = await import('../../../lib/api');
        if (!api.apiConfigured) return;
        const me = await api.fetchCreatorMe();
        const baseArea = me?.base_area?.trim();
        if (!baseArea || cancelled) return;
        const geo = await import('../../../lib/geo');
        // Server list is authoritative; MOCK_AREAS is its exact documented
        // mirror, used only when the fetch fails so the row can still render.
        const areas = (await api.fetchServiceAreas())?.areas ?? geo.MOCK_AREAS;
        const centre = areas.find((a) => a.name.trim().toLowerCase() === baseArea.toLowerCase());
        if (!centre || cancelled) return;
        setDistanceFromBase({
          km: geo.haversineKm(centre.lat, centre.lng, meetingLat, meetingLng),
          from: centre.name,
        });
      } catch (err) {
        // Distance stays absent — but never silently: this chain failing
        // means every offer this creator sees is missing its distance.
        const { captureHandledError } = await import('../../../lib/sentry');
        captureHandledError(err, 'creator_job:offer_distance');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage, job?.type, meetingLat, meetingLng]);

  // Final-edit uploads (in-person delivery + revision re-delivery) go through
  // the shared batch uploader — per-file progress, retry skips what landed.
  const finalsBatch = useUploadBatch(String(id), 'deliverable');
  const rawBatch = useUploadBatch(String(id), 'raw');
  const [existingFinals, setExistingFinals] = React.useState(0);
  const [deliveredNow, setDeliveredNow] = React.useState(false);
  // Remote and Social run their own panels inside this screen, so they report
  // their unsent state up rather than the guard below guessing at it.
  const [childUndelivered, setChildUndelivered] = React.useState(false);

  // Open revision round (API mode): shown in the submitted stage. Declared
  // BEFORE the early returns below — hooks after a conditional return crash
  // the moment the condition flips mid-mount (deep-link hydration does).
  /** ALL open requests — see RemoteJob for why the oldest-only read was a
   *  dispute risk. Same server list, same rule on both creator screens. */
  const [openRevisions, setOpenRevisions] = React.useState<
    { id: string; details: string; createdAt: string; isFree: boolean }[]
  >([]);
  React.useEffect(() => {
    // Remote orders run their own screen (RemoteJob) with its own revision
    // handling — this effect is the in-person path only.
    if (stage !== 'submitted' || job?.type === 'remote') return;
    import('../../../lib/api').then(({ apiConfigured: cfgd, fetchRevisionsApi, fetchMediaListingApi }) => {
      if (!cfgd) return;
      fetchRevisionsApi(String(id)).then((revs) => {
        const openList = (revs ?? []).filter((r) => r.status === 'open');
        setOpenRevisions(
          openList.map((r) => ({ id: r.id, details: r.details, createdAt: r.created_at, isFree: r.is_free })),
        );
      });
      // Finals registered before this visit (an interrupted earlier attempt)
      // count toward the review line rather than vanishing from it.
      fetchMediaListingApi(String(id)).then((listing) => {
        if (listing) {
          setExistingFinals(listing.media.filter((m) => m.kind === 'deliverable' && !m.deleted).length);
        }
      });
    });
  }, [stage, id, job?.type]);

  // DEEP LINK SELF-HYDRATION. Opening this screen from a notification never
  // runs the Jobs list, so the offer store is empty and `job` is undefined.
  // Previously that rendered `null` — a blank white screen with no way back,
  // which is exactly what a tapped job-offer push produced on a cold start.
  const { setOffers } = useCreator();
  const [hydrating, setHydrating] = React.useState(!job && apiConfigured);
  React.useEffect(() => {
    if (job || !apiConfigured) return;
    let cancelled = false;
    import('../../../lib/api').then(({ fetchMyBookings, isCreatorRole }) =>
      fetchMyBookings().then((bookings) => {
        if (cancelled) return;
        if (bookings) {
          // Same creator-role rule as the dashboard hydrator — these are the
          // two sites that fill the offers store, and a client-role row
          // slipping in here renders someone's own order as their job.
          const me = useAuth.getState().userId;
          setOffers(
            bookings
              .filter((b) => JOB_STATUSES.includes(b.status) && isCreatorRole(b, me))
              .map(bookingToOffer),
          );
        }
        setHydrating(false);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [job, setOffers]);

  /**
   * LEAVING WITH THE WORK UPLOADED BUT UNDELIVERED.
   *
   * That is the state booking c8a63e3b was found in: finished files on the
   * server, `delivered_at` null, a paying client with nothing to download and
   * no notification. Uploading and delivering are two separate calls and only
   * the second one reaches the client, so walking away between them is silent
   * by default.
   *
   * Three exits, three answers: the header back and the Android hardware back
   * both confirm here, and the scheduler's `uploaded_not_delivered` sweep
   * catches everything this cannot — a force-quit, a dead battery, a creator
   * who taps "Leave anyway".
   */
  const undelivered =
    job?.type === 'remote' || job?.social
      ? childUndelivered
      : openRevisions.length > 0
        ? finalsBatch.doneCount > 0
        : !job?.deliveredAt && !deliveredNow && finalsBatch.doneCount + existingFinals > 0;

  const confirmLeave = React.useCallback(() => {
    if (!undelivered) {
      safeBack();
      return;
    }
    Alert.alert(
      'Not delivered yet',
      "Your files are uploaded, but the client can't see them and hasn't been told. Nothing reaches them until you slide to deliver.",
      [
        { text: 'Stay and deliver', style: 'cancel' },
        { text: 'Leave anyway', style: 'destructive', onPress: () => safeBack() },
      ],
    );
  }, [undelivered]);

  React.useEffect(() => {
    if (!undelivered) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeave();
      return true; // handled — the pop is ours to allow
    });
    return () => sub.remove();
  }, [undelivered, confirmLeave]);

  if (hydrating) {
    return (
      <View style={styles.gone}>
        <ActivityIndicator color={colors.yellowDark} />
      </View>
    );
  }

  // Genuinely not there: the offer expired and was reassigned, the booking
  // was cancelled, or it was never this creator's. Say which, and give them
  // somewhere to go — an offer that lapsed is normal, not an error.
  if (!job) {
    return (
      <View style={styles.gone}>
        <ScreenHeader title="Job offer" />
        <View style={styles.goneBody}>
          <Text style={styles.goneTitle}>This offer is no longer available</Text>
          <Text style={styles.goneText}>
            It was either accepted by another creator, withdrawn, or the accept window closed.
            Offers hold for a short time so clients aren't left waiting.
          </Text>
          <Pressable onPress={() => router.replace('/creator')} style={styles.goneCta}>
            <Text style={styles.goneCtaLabel}>See my jobs</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  const next = (s: JobStage) => setStage(job.id, s);
  const rushNotice = job.rush ? (
    <View style={styles.rushNotice}>
      <Text style={styles.rushNoticeTitle}>Rush job — edits due within hours</Text>
      <Text style={styles.rushNoticeBody}>
        This client paid for rush delivery, so their edits are due within {rushHours} hours of the
        session ending. The rush fee is included in your payout for this job.
      </Text>
    </View>
  ) : null;

  // Real endpoint calls in API mode (Phase 3 session/media pipeline);
  // mock stage machine otherwise.
  const withApi = async (fn: (api: typeof import('../../../lib/api')) => Promise<boolean>) => {
    const api = await import('../../../lib/api');
    setActionError(null);
    if (!api.apiConfigured) return true;
    return fn(api);
  };

  const acceptJob = async () => {
    const ok = await withApi(async (api) => {
      const r = await api.acceptBookingApi(job.id);
      if (r && 'error' in r) {
        setActionError(r.error); // offer expired/reassigned
        return false;
      }
      return true;
    });
    if (ok) {
      haptic('success'); // the job is theirs
      next('accepted');
    }
    return ok; // false unlocks the slider for a retry
  };

  const arriveCheckIn = () =>
    withApi(async (api) => {
      const r = await api.checkInApi(job.id);
      if (r && 'error' in r) {
        setActionError(r.error);
        return false;
      }
      return true;
    }).then((ok) => ok && next('checkin'));

  const verifyAndStart = () =>
    withApi(async (api) => {
      const r = await api.verifySafetyCodeApi(job.id, code);
      if (r && 'error' in r) {
        setActionError(r.error); // wrong code
        haptic('error');
        return false;
      }
      haptic('success'); // code accepted, the session is live
      return true;
    }).then((ok) => ok && next('session'));


  const deliverRevision = () =>
    // Returns the success flag so a failed delivery unlocks the slider.
    withApi(async (api) => {
      if (openRevisions.length === 0) return false;
      const r = await api.deliverRevisionApi(job.id, openRevisions[0].id);
      if (r && 'error' in r) {
        setActionError(r.error);
        return false;
      }
      setOpenRevisions([]);
      finalsBatch.reset();
      haptic('success'); // the revision reached the client
      return true;
    });

  // In-person delivery: the deliberate act after the shoot is edited.
  const deliverFinals = () =>
    withApi(async (api) => {
      const r = await api.deliverApi(job.id);
      if (!r || 'error' in (r as object)) {
        setActionError((r as { error?: string })?.error ?? 'Delivery failed — try again.');
        return false;
      }
      setDeliveredNow(true);
      finalsBatch.reset();
      haptic('success'); // the client has their edit
      return true;
    });

  const submitFootage = async () => {
    // In-person only: the batch uploader has already landed every file when
    // this slider unlocks — sliding is the session-completion act (the
    // payout trigger). Remote orders never enter this stage machine.
    const ok = await withApi(async (api) => {
      const r = await api.completeSessionApi(job.id);
      if (r && 'error' in r) {
        setActionError(r.error);
        return false;
      }
      return true;
    });
    if (ok) {
      rawBatch.reset();
      haptic('success'); // session complete, payout triggered
      next('submitted');
    }
    return ok; // false unlocks the slider for a retry
  };

  const summaryCard = (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ minWidth: 0 }}>
          <Text style={styles.jobTitle}>{job.title}</Text>
          <Text style={styles.jobOccasion}>{job.occasion}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.pay}>{formatMoney(job.payUsd, currency)}</Text>
          <Text style={styles.paySub}>your take after fees</Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={colors.grey} strokeWidth={1.8} />
          <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={colors.grey} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
        <Text style={styles.metaLabel}>{job.when}</Text>
      </View>
      <View style={styles.metaRow}>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
          <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={colors.grey} strokeWidth={1.8} strokeLinejoin="round" />
          <Circle cx="12" cy="10" r="2.3" stroke={colors.grey} strokeWidth={1.8} />
        </Svg>
        <Text style={styles.metaLabel}>{job.loc}</Text>
      </View>
    </View>
  );

  // REMOTE ORDERS ARE DESK JOBS. Once accepted they leave the in-person
  // stage machine entirely — no meeting point, no check-in, no safety code
  // (the server refuses both for remote bookings). One screen: the order,
  // the client's files, the deadline, the deliberate Deliver act.
  if (job.type === 'remote' && stage !== 'offer') {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Remote edit order" onBack={confirmLeave} />
        <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {summaryCard}
          {rushNotice}
          <RemoteJob job={job} onUndeliveredChange={setChildUndelivered} />
          <View style={{ height: 24 }} />
        </KeyboardScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title={STAGE_TITLES[stage]} onBack={confirmLeave} />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {summaryCard}

        {/* Directly under the pay card: how long this offer holds. Absent
            when the server sent no expiry (mock mode) — a countdown nobody
            authoritative is running would be an invented deadline. */}
        {stage === 'offer' && !offerExpired && offerRemainMs != null && (
          <View style={[styles.countCard, offerRemainMs < URGENT_REMAINING_MS && styles.countCardUrgent]}>
            <OfferCountdownRing remainMs={offerRemainMs} windowMs={offerWindowMs} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.countTitle, offerRemainMs < URGENT_REMAINING_MS && styles.countTitleUrgent]}>
                Respond within {formatRemaining(offerRemainMs)}
              </Text>
              <Text style={styles.countSub}>
                This offer is held for you until then — after that it goes to another creator.
              </Text>
            </View>
          </View>
        )}
        {offerExpired && (
          <View style={styles.expiredCard}>
            <Text style={styles.expiredTitle}>This offer has expired</Text>
            <Text style={styles.expiredBody}>
              The response window closed before the job was accepted, so it's being offered to
              another creator. You'll get the next one that matches your specialties.
            </Text>
          </View>
        )}

        {/* Rush is shown at EVERY stage, not just the offer — the creator
            who accepted this morning needs the clock in front of them when
            they sit down to edit. (Expired offer: the clock is moot.) */}
        {!offerExpired && rushNotice}

        {stage === 'offer' && !offerExpired && (
          <>
            {/* No "client note" card here. It used to render one invented
                sentence — the same words attributed to every client on every
                offer — and there is no field behind it: bookings carry no
                client note column. The meeting point the client DID enter IS
                real — it renders below, because "where exactly" is half of a
                5:30 AM accept/decline decision. */}
            {job.type === 'in-person' && (
              <>
                <View style={{ marginTop: 14 }}>
                  {/* Static by construction (MeetingMap disables every
                      gesture). Missing coordinates render its labeled
                      placeholder, not a blank tile. */}
                  <MeetingMap
                    lat={job.meetingLat}
                    lng={job.meetingLng}
                    height={170}
                    label={
                      job.meetingLat != null && job.meetingLng != null
                        ? `Meeting point · ${job.loc}`
                        : `${job.loc} — exact meeting point confirmed after you accept`
                    }
                  />
                </View>
                {/* Distance from STORED base area only — the row is simply
                    absent when it can't be computed. Never 0, never a dash
                    that reads as zero. */}
                {distanceFromBase && (
                  <View style={styles.distRow}>
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke={colors.greyWarm} strokeWidth={1.8} strokeLinejoin="round" />
                      <Circle cx="12" cy="10" r="2.3" stroke={colors.greyWarm} strokeWidth={1.8} />
                    </Svg>
                    <Text style={styles.distText}>
                      {formatKm(distanceFromBase.km)} from {distanceFromBase.from}, your base area
                    </Text>
                  </View>
                )}
                {!!job.directions && (
                  <View style={styles.noteCard}>
                    <Text style={styles.noteTitle}>Directions from the client</Text>
                    <Text style={styles.noteBody}>{job.directions}</Text>
                  </View>
                )}
              </>
            )}
            <View style={styles.warnCard}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ marginTop: 1 }}>
                <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.8} />
                <Path d="M12 11v5" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
                <Circle cx="12" cy="8" r="1.1" fill={colors.yellowDark} />
              </Svg>
              <Text style={styles.warnText}>
                Accepting commits you to this session. Late cancellations count double toward your
                reliability standing.
              </Text>
            </View>
          </>
        )}

        {stage === 'accepted' && (
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={styles.successTitle}>You're booked!</Text>
            <Text style={styles.successSub}>
              The client has been notified. It's on your schedule — head out in time on the day.
            </Text>
          </View>
        )}

        {stage === 'onway' && (
          <>
            <View style={{ marginTop: 14 }}>
              <MeetingMap
                lat={job.meetingLat}
                lng={job.meetingLng}
                label={`Meeting point · ${job.loc}`}
              />
            </View>
            {!!job.directions && (
              <View style={styles.noteCard}>
                <Text style={styles.noteTitle}>Directions from the client</Text>
                <Text style={styles.noteBody}>{job.directions}</Text>
              </View>
            )}
          </>
        )}

        {stage === 'checkin' && (
          <>
            <Text style={styles.checkinLead}>
              Ask the client for their 4-digit safety code to start the session.
            </Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="• • • •"
              placeholderTextColor="#C6C3BC"
              keyboardType="number-pad"
              maxLength={4}
              style={styles.codeInput}
            />
            {/* Creator-side no-show: attempted-contact confirmation gates the
                report, then slide-to-confirm (handoff §8) */}
            <View style={styles.graceCard}>
              <Text style={styles.graceTitle}>Client not here?</Text>
              <Text style={styles.graceNote}>
                A {NO_SHOW_GRACE_MINUTES}-minute grace period applies. Before reporting a no-show, confirm
                you've tried to reach them.
              </Text>
              <Pressable onPress={() => setContactConfirmed(!contactConfirmed)} style={styles.contactRow}>
                <View style={[styles.checkbox, contactConfirmed && styles.checkboxOn]}>
                  {contactConfirmed && (
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12.5l4 4L19 7" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
                <Text style={styles.contactLabel}>I've called and messaged the client</Text>
              </Pressable>
              {contactConfirmed && (
                <View style={{ marginTop: 12 }}>
                  <SlideToConfirm
                    label="Slide to report client no-show"
                    onConfirm={() => {
                      next('submitted');
                      router.back();
                    }}
                  />
                </View>
              )}
            </View>
          </>
        )}

        {/* SESSION CLOCK. Elapsed from the server's session_active_at,
            remaining against the booked end. Running over is normal — the
            card says so in yellow and keeps counting; it never turns red,
            never stops, and never gates the wrap-up button below. */}
        {stage === 'session' && (sessionStartMs != null || bookedEndMs != null) && (
          <View style={styles.timerCard}>
            <View style={styles.timerRow}>
              {sessionStartMs != null && (
                <View style={{ flex: 1 }}>
                  <Text style={styles.timerLabel}>ELAPSED</Text>
                  <Text style={styles.timerValue}>
                    {formatClock(sessionNowMs - sessionStartMs)}
                  </Text>
                </View>
              )}
              {bookedEndMs != null &&
                (bookedEndMs - sessionNowMs > 0 ? (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.timerLabel}>REMAINING</Text>
                    <Text style={styles.timerValue}>
                      {formatClock(bookedEndMs - sessionNowMs)}
                    </Text>
                  </View>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.timerLabel, styles.timerLabelOver]}>OVERTIME</Text>
                    <Text style={[styles.timerValue, styles.timerValueOver]}>
                      +{formatClock(sessionNowMs - bookedEndMs)}
                    </Text>
                  </View>
                ))}
            </View>
            {bookedEndMs != null && (
              <Text style={styles.timerEnds}>
                {bookedEndMs - sessionNowMs > 0 ? 'Ends' : 'Was booked to end'}{' '}
                {new Date(bookedEndMs).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            )}
            {sessionStartMs == null && sessionProbed && (
              <Text style={styles.timerEnds}>
                Elapsed time isn't available for this session.
              </Text>
            )}
          </View>
        )}

        {stage === 'session' && (
          <View style={styles.successCard}>
            <View style={[styles.successIcon, { backgroundColor: '#EAF8F0' }]}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Rect x="3" y="6.5" width="18" height="13" rx="3" stroke="#1B9A57" strokeWidth={1.8} />
                <Circle cx="12" cy="13" r="3.3" stroke="#1B9A57" strokeWidth={1.8} />
              </Svg>
            </View>
            <Text style={styles.successTitle}>Session active</Text>
            <Text style={styles.successSub}>
              Code verified. Do your thing — wrap the session here when you're done shooting.
            </Text>
          </View>
        )}

        {/* SOCIAL: post-session the pipeline is proofs → client selection →
            edit the chosen set. Server state decides the phase, so this
            renders for both local stages a social job can be in. */}
        {job.social && (stage === 'upload' || stage === 'submitted') && openRevisions.length === 0 && (
          <SocialPipeline
            bookingId={job.id}
            included={job.social}
            onUndeliveredChange={setChildUndelivered}
          />
        )}

        {!job.social && stage === 'upload' && (
          <>
            <Text style={styles.checkinLead}>
              Upload the raw footage from today's session — you'll edit and deliver from it. The
              client never sees raws.
            </Text>
            <DeliverPanel
              batch={rawBatch}
              pickTitle="Add session footage"
              pickSub="RAW, JPG, MP4, MOV — everything from today"
              slideLabel="Slide to submit footage"
              onDeliver={submitFootage}
              error={actionError}
            />
          </>
        )}

        {stage === 'submitted' && openRevisions.length > 0 && (
          <>
            <Text style={styles.checkinLead}>
              {openRevisions.length === 1
                ? 'Revision requested — the client asked for changes:'
                : `${openRevisions.length} revision requests — the client asked for changes:`}
            </Text>
            {openRevisions.map((r, i) => (
              <View key={r.id} style={[styles.card, i > 0 && { marginTop: 8 }]}>
                {/* Same plain-words free/paid label as the remote panel. */}
                <Text style={{ fontSize: 10.5, color: colors.grey, fontWeight: '700', marginBottom: 3 }}>
                  {openRevisions.length > 1 ? `${i + 1} of ${openRevisions.length} · ` : ''}
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {' · '}
                  {r.isFree ? 'Included revision' : 'Paid revision'}
                </Text>
                <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>{r.details}</Text>
              </View>
            ))}
            <DeliverPanel
              batch={finalsBatch}
              pickTitle="Add the updated files"
              pickSub="Full-resolution, unwatermarked — this replaces the delivery"
              slideLabel="Slide to deliver revision"
              notDeliveredNote="The client still has the previous version. Your updated files do not replace it until you slide below."
              onDeliver={deliverRevision}
              error={actionError}
            />
          </>
        )}
        {!job.social && stage === 'submitted' && openRevisions.length === 0 && (job.deliveredAt || deliveredNow) && (
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={styles.successTitle}>Delivered</Text>
            <Text style={styles.successSub}>
              The client has their edits and has been notified. Your payout lands in Earnings once
              the review window closes.
            </Text>
          </View>
        )}
        {!job.social && stage === 'submitted' && openRevisions.length === 0 && !job.deliveredAt && !deliveredNow && (
          <>
            <Text style={styles.checkinLead}>
              Footage is in — you do the edit. Upload the finished files and deliver them to the
              client. Their delivery window is counting from the session's end.
            </Text>
            <DeliverPanel
              batch={finalsBatch}
              alreadyUploaded={existingFinals}
              pickTitle="Add your finished edits"
              pickSub="Full-resolution, unwatermarked — this is what the client receives"
              slideLabel="Slide to submit finished edit"
              notDeliveredNote="These files are uploaded, but the client cannot see or download them yet. This job stays open, and unpaid, until you slide below."
              onDeliver={deliverFinals}
              error={actionError}
            />
          </>
        )}
        <View style={{ height: 24 }} />
      </KeyboardScrollView>

      <View style={styles.footer}>
        {/* Upload/submitted-stage errors render inside the DeliverPanel, next to its slider. */}
        {actionError && stage !== 'submitted' && stage !== 'upload' ? (
          <Text style={styles.actionError}>{actionError}</Text>
        ) : null}
        {stage === 'offer' && !offerExpired && (
          <SlideToConfirm label="Slide to accept this job" onConfirm={acceptJob} />
        )}
        {offerExpired && (
          <Button title="See my jobs" onPress={() => router.replace('/creator')} />
        )}
        {stage === 'accepted' && (
          <Button title="I'm on my way" arrow onPress={() => next('onway')} />
        )}
        {stage === 'onway' && (
          <Button title="I've arrived — check in" arrow onPress={arriveCheckIn} />
        )}
        {stage === 'checkin' && (
          <Button
            title="Verify code & start session"
            disabled={code.length !== 4}
            onPress={verifyAndStart}
          />
        )}
        {stage === 'session' && (
          <Button title="Wrap session — upload footage" arrow onPress={() => next('upload')} />
        )}
        {job.social && (stage === 'upload' || stage === 'submitted') && openRevisions.length === 0 && (
          <Button title="Back to jobs" variant="ghost" onPress={() => router.back()} />
        )}
        {!job.social && stage === 'submitted' && openRevisions.length === 0 && (job.deliveredAt || deliveredNow) && (
          <Button title="Back to jobs" variant="ghost" onPress={() => router.back()} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rushNotice: {
    backgroundColor: '#FFE9E4',
    borderRadius: 14,
    padding: 13,
    marginBottom: 14,
  },
  rushNoticeTitle: { fontSize: 13.5, fontWeight: '800', color: '#C0392B' },
  rushNoticeBody: { fontSize: 12, color: '#8C3A2E', lineHeight: 17.5, marginTop: 4 },
  gone: { flex: 1, backgroundColor: colors.offWhite, justifyContent: 'center' },
  goneBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 10 },
  goneTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, textAlign: 'center' },
  goneText: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center' },
  goneCta: {
    height: 50,
    borderRadius: 15,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 18,
  },
  goneCtaLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  jobTitle: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  jobOccasion: { fontSize: 11, color: colors.greyWarm, marginTop: 2 },
  pay: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  paySub: { fontSize: 10.5, color: colors.grey, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  metaLabel: { fontSize: 11.5, color: colors.greyWarm },
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  noteTitle: { fontSize: 10, fontWeight: '800', color: colors.yellowDark, letterSpacing: 0.5, textTransform: 'uppercase' },
  noteBody: { fontSize: 13, color: '#3D3A34', lineHeight: 20, marginTop: 8 },
  countCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    // Same 14pt rhythm as the rush notice, the map and the warning card —
    // this was the one block on the screen with no top margin.
    marginTop: 14,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 14,
    padding: 13,
    marginBottom: 14,
  },
  // Under two minutes: the whole card goes red, not just the digits.
  countCardUrgent: { backgroundColor: '#FFE9E4', borderColor: '#F3C4B8' },
  countTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8A6800',
    fontVariant: ['tabular-nums'],
  },
  countTitleUrgent: { color: '#C0392B' },
  countSub: { fontSize: 11.5, color: colors.greyWarm, lineHeight: 16.5, marginTop: 3 },
  expiredCard: {
    backgroundColor: '#F1EEE7',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  expiredTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  expiredBody: { fontSize: 12.5, color: colors.grey, lineHeight: 19, marginTop: 6 },
  timerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  timerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  timerLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: colors.greyWarm,
  },
  // Overtime is normal, not an error: yellow, never red.
  timerLabelOver: { color: colors.yellowDark },
  timerValue: {
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.ink,
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  timerValueOver: { color: colors.yellowDark },
  timerEnds: { fontSize: 12, color: colors.grey, marginTop: 12 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 2 },
  distText: { fontSize: 12, fontWeight: '600', color: colors.greyWarm },
  warnCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 14,
    padding: 13,
    marginTop: 14,
  },
  warnText: { flex: 1, fontSize: 11.5, color: '#8A6800', lineHeight: 17, fontWeight: '600' },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  successTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  successSub: { fontSize: 13, color: colors.grey, marginTop: 8, lineHeight: 19, textAlign: 'center' },
  map: { height: 210, borderRadius: 16, backgroundColor: '#E5E2DB', marginTop: 14, overflow: 'hidden' },
  mapLegend: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { fontSize: 10.5, fontWeight: '600', color: colors.ink },
  checkinLead: { fontSize: 14, color: colors.grey, lineHeight: 20, marginTop: 16 },
  codeInput: {
    height: 74,
    borderWidth: 1.5,
    borderColor: '#E7E7E7',
    borderRadius: 18,
    backgroundColor: '#fff',
    textAlign: 'center',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 14,
    color: colors.ink,
    marginTop: 14,
  },
  graceCard: {
    backgroundColor: '#FFF9EC',
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 16,
    padding: 15,
    marginTop: 16,
  },
  graceTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  graceNote: { fontSize: 12, color: colors.grey, lineHeight: 18, marginTop: 6 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#D8D2C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  contactLabel: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.ink },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  actionError: { fontSize: 12.5, color: colors.error, fontWeight: '600', marginBottom: 10 },
});
