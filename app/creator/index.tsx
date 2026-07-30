import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useAuth } from '../../lib/store';
import { JobOffer, useCreator } from '../../lib/store/creator';
import { apiConfigured, fetchMyBookings } from '../../lib/api';
import { CREATOR_PLATFORM_FEE_RATE, formatMoney } from '../../lib/constants/business';
import { colors, insetTop } from '../../lib/theme';

export default function CreatorHome() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const name = useAuth((s) => s.name);
  const { available, toggleAvailable, offers, jobStages, declineOffer, setOffers, setStage } =
    useCreator();
  const openOffers = offers.filter((o) => !jobStages[o.id] || jobStages[o.id] === 'offer');

  // API mode: real bookings replace the mock list. Pending-assigned rows are
  // live OFFERS (15-min accept window, countdown from offer_expires_at);
  // confirmed rows are accepted jobs.
  React.useEffect(() => {
    if (!apiConfigured) return;
    fetchMyBookings().then((bookings) => {
      if (!bookings) return;
      const mine = bookings.filter((b) => ['pending', 'confirmed', 'completed'].includes(b.status));
      const jobs: JobOffer[] = mine.map((b) => ({
        id: b.id,
        title: b.occasion ? `${b.occasion} session` : 'Remote edit order',
        occasion: b.occasion ?? 'Portraits',
        payUsd:
          Math.round(
            (b.pricing_snapshot?.session_price_usd ?? b.price_usd) *
              (1 - CREATOR_PLATFORM_FEE_RATE) *
              100,
          ) / 100,
        when: b.scheduled_at
          ? `${new Date(b.scheduled_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${new Date(b.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${b.duration_hours} hrs`
          : 'Remote · deliver in-app',
        loc: b.area ?? 'Remote edit',
        distanceKm: 0,
        urgent: b.status === 'pending',
        expiresAt: b.status === 'pending' ? b.offer_expires_at ?? undefined : undefined,
        type: b.type === 'in_person' ? 'in-person' : 'remote',
      }));
      setOffers(jobs);
      for (const b of mine) setStage(b.id, b.status === 'pending' ? 'offer' : b.status === 'completed' ? 'submitted' : 'accepted');
    });
  }, []);

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

  const decline = async (id: string) => {
    if (apiConfigured) {
      const { declineBookingApi } = await import('../../lib/api');
      await declineBookingApi(id); // reassigns server-side, no strike
    }
    declineOffer(id);
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
            onPress={toggleAvailable}
            style={[styles.switchTrack, available && styles.switchTrackOn]}
          >
            <View style={[styles.switchKnob, available && styles.switchKnobOn]} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
        {/* Earnings strip */}
        <Pressable onPress={() => router.push('/creator/earnings')} style={styles.earnCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.earnLabel}>Today</Text>
            <Text style={styles.earnValue}>{formatMoney(95.2, currency)}</Text>
          </View>
          <View style={styles.earnDiv} />
          <View style={{ flex: 1 }}>
            <Text style={styles.earnLabel}>This week</Text>
            <Text style={styles.earnValue}>{formatMoney(438.6, currency)}</Text>
          </View>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M9 6l6 6-6 6" stroke="#C6C3BC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>

        <View style={styles.offersHead}>
          <Text style={styles.offersTitle}>Job offers near you</Text>
          {available && <Text style={styles.live}>Live</Text>}
        </View>

        {available ? (
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
                    <Pressable onPress={() => decline(j.id)} style={styles.declineBtn}>
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
              <Text style={styles.emptyTitle}>No jobs right now</Text>
              <Text style={styles.emptySub}>
                We'll notify you the moment a shoot or edit comes in near you. You're all set — keep your
                notifications on.
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
        <View style={{ height: 130 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
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
