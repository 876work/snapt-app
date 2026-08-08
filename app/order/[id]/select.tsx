import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../../lib/text';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Button } from '../../../components/ui/Button';
import { useAuth } from '../../../lib/store';
import { formatMoney } from '../../../lib/constants/business';
import type { SelectionState } from '../../../lib/api';
import { colors, insetBottom, spacing } from '../../../lib/theme';

/**
 * Social bundle proof selection.
 *
 * The client picks WHICH shots get fully edited — up to the tier's included
 * counts for free, beyond them at the per-unit add-on price (a real charge
 * through PaymentSheet; the selection locks when the webhook confirms).
 *
 * The proofs shown here are the creator's curated watermarked/low-res
 * exports. This is deliberately not the raw-footage rule bending: raw
 * camera originals still never reach a client.
 */
export default function ProofSelection() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useAuth((s) => s.currency);

  const [state, setState] = React.useState<SelectionState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { fetchSelectionApi } = await import('../../../lib/api');
    const s = await fetchSelectionApi(String(id));
    setState(s);
    if (s) {
      // Start from what the server already has (a re-visit mid-flow, or a
      // pending unpaid extras attempt).
      setChosen(new Set(s.proofs.filter((p) => p.selected).map((p) => p.id)));
    }
    setLoading(false);
    return s;
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.root, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.yellowDark} />
      </View>
    );
  }

  if (!state) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Choose your shots" />
        <View style={styles.centre}>
          <Text style={styles.centreTitle}>Nothing to choose yet</Text>
          <Text style={styles.centreBody}>
            Your creator hasn't shared the proof gallery for this session. We'll notify you the
            moment it's ready.
          </Text>
        </View>
      </View>
    );
  }

  const photos = state.proofs.filter((p) => !p.is_video);
  const videos = state.proofs.filter((p) => p.is_video);
  const pickedPhotos = photos.filter((p) => chosen.has(p.id)).length;
  const pickedVideos = videos.filter((p) => chosen.has(p.id)).length;
  const extraPhotos = Math.max(0, pickedPhotos - state.included.photos);
  const extraVideos = Math.max(0, pickedVideos - state.included.videos);
  const extrasBase =
    Math.round(
      (extraPhotos * state.addon_prices.extra_photo_usd +
        extraVideos * state.addon_prices.extra_video_usd) *
        100,
    ) / 100;
  const extrasTotal = Math.round(extrasBase * (1 + state.client_service_fee_rate) * 100) / 100;

  const deadlineLabel = (() => {
    if (!state.selection_deadline_at) return null;
    const ms = new Date(state.selection_deadline_at).getTime() - Date.now();
    if (ms <= 0) return 'Selection window closed';
    const h = Math.floor(ms / 3600_000);
    return h >= 1 ? `${h}h left to choose` : `${Math.max(1, Math.floor(ms / 60_000))}m left to choose`;
  })();

  const toggle = (pid: string) => {
    if (state.locked) return;
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { submitSelectionApi } = await import('../../../lib/api');
    const r = await submitSelectionApi(String(id), [...chosen]);
    if (!r || r.error) {
      setError(r?.error ?? "Couldn't save your selection — try again.");
      setBusy(false);
      return;
    }
    if (r.locked) {
      await load();
      setBusy(false);
      return;
    }
    // Extras need paying. Sheet on-device; the LOCK comes from the webhook,
    // so poll the server for it rather than trusting the sheet.
    if (r.client_secret) {
      const { payForSelectionExtras } = await import('../../../lib/payments');
      const outcome = await payForSelectionExtras({
        client_secret: r.client_secret,
        customer_id: r.customer_id,
        ephemeral_key: r.ephemeral_key,
      });
      if (!outcome.ok) {
        setError(
          outcome.reason === 'cancelled'
            ? 'Payment cancelled — your selection is saved but not locked yet.'
            : outcome.message ?? 'Payment failed — no charge was made.',
        );
        setBusy(false);
        return;
      }
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const s = await load();
        if (s?.locked) break;
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    setBusy(false);
  };

  const Grid = ({ items, label }: { items: typeof state.proofs; label: string }) =>
    items.length === 0 ? null : (
      <>
        <Text style={styles.sectionLabel}>{label}</Text>
        <View style={styles.grid}>
          {items.map((p) => {
            const on = chosen.has(p.id);
            return (
              <Pressable key={p.id} onPress={() => toggle(p.id)} style={styles.cell}>
                <Image source={{ uri: p.download_url }} style={styles.thumb} resizeMode="cover" />
                {p.is_video && (
                  <View style={styles.videoBadge}>
                    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                      <Path d="M8 5.5v13l11-6.5-11-6.5z" fill="#fff" />
                    </Svg>
                  </View>
                )}
                <View style={[styles.tick, on && styles.tickOn]}>
                  {on && (
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12.5l4.5 4.5L19 7.5" stroke="#1A1A1A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </>
    );

  return (
    <View style={styles.root}>
      <ScreenHeader title="Choose your shots" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {state.locked ? (
          <View style={styles.lockedNote}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M7 11V8a5 5 0 0110 0v3M6 11h12v9H6v-9z" stroke="#1E7A45" strokeWidth={1.9} strokeLinejoin="round" />
            </Svg>
            <Text style={styles.lockedText}>
              Your selection is locked and with your creator for editing. Delivery lands in the
              app as usual.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.lead}>
              Pick the shots you want fully edited. Your bundle includes{' '}
              <Text style={{ fontWeight: '800' }}>
                {state.included.photos} photos
                {state.included.videos > 0 ? ` and ${state.included.videos} video${state.included.videos > 1 ? 's' : ''}` : ''}
              </Text>
              {' '}— choose more and the extras are added at{' '}
              {formatMoney(state.addon_prices.extra_photo_usd, currency)}/photo
              {state.included.videos > 0 || videos.length > 0
                ? ` and ${formatMoney(state.addon_prices.extra_video_usd, currency)}/video`
                : ''}
              .
            </Text>
            {deadlineLabel && (
              <View style={styles.deadline}>
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Circle cx="12" cy="12" r="9" stroke="#8A6800" strokeWidth={1.8} />
                  <Path d="M12 7.5V12l3 2" stroke="#8A6800" strokeWidth={1.8} strokeLinecap="round" />
                </Svg>
                <Text style={styles.deadlineText}>
                  {deadlineLabel} — after that your creator's top picks go ahead automatically.
                </Text>
              </View>
            )}
          </>
        )}

        <Grid items={photos} label={`Photos · ${pickedPhotos}/${state.included.photos} included`} />
        <Grid
          items={videos}
          label={`Videos · ${pickedVideos}/${state.included.videos} included`}
        />
        <View style={{ height: 130 }} />
      </ScrollView>

      {!state.locked && (
        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.footLabel}>
              {extrasBase > 0 ? `${extraPhotos + extraVideos} extra picks` : 'Within your bundle'}
            </Text>
            <Text style={styles.footValue}>
              {extrasBase > 0 ? `+${formatMoney(extrasTotal, currency)}` : formatMoney(0, currency)}
            </Text>
          </View>
          <Button
            title={busy ? 'Saving…' : extrasBase > 0 ? 'Pay & lock selection' : 'Lock selection'}
            disabled={busy || chosen.size === 0}
            onPress={submit}
            style={{ flex: 1.4 }}
          />
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 6 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 8 },
  centreTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  centreBody: { fontSize: 13, color: colors.grey, lineHeight: 19, textAlign: 'center' },
  lead: { fontSize: 13.5, color: colors.grey, lineHeight: 20 },
  deadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.yellowSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 12,
  },
  deadlineText: { flex: 1, fontSize: 12, color: '#8A6800', fontWeight: '600', lineHeight: 17 },
  lockedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#E7F8EE',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  lockedText: { flex: 1, fontSize: 12.5, color: '#1E7A45', fontWeight: '600', lineHeight: 18 },
  sectionLabel: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 20, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31.5%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  thumb: { width: '100%', height: '100%' },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(26,26,26,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1.5,
    borderColor: '#D9D5CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  footLabel: { fontSize: 11, color: colors.grey },
  footValue: { fontSize: 17, fontWeight: '800', color: colors.ink },
  error: {
    position: 'absolute',
    bottom: Math.max(insetBottom + 92, 110),
    left: 20,
    right: 20,
    textAlign: 'center',
    fontSize: 12.5,
    fontWeight: '700',
    color: '#A32C2C',
  },
});
