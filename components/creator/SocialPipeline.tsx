import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { Button } from '../ui/Button';
import type { SelectionState } from '../../lib/api';
import { BatchFileList, DeliverPanel, useUploadBatch } from './DeliverUploader';
import { colors } from '../../lib/theme';
import { haptic } from '../../lib/haptics';

/**
 * The creator's post-session flow for a Social bundle job. Replaces the raw
 * footage dropzone: Social's edit is DEFINED by the client's selection, so
 * the pipeline is proofs → client picks (or the deadline picks) → edit the
 * chosen set → deliver.
 *
 * Every phase is derived from SERVER state, not the local stage machine, so
 * a deep link or a re-open lands on the truth.
 */
export function SocialPipeline({
  bookingId,
  included,
  onUndeliveredChange,
}: {
  bookingId: string;
  included: { photos: number; videos: number };
  /** Final edits landed, delivery not sent — the parent screen guards the exit on it. */
  onUndeliveredChange?: (undelivered: boolean) => void;
}) {
  const [state, setState] = React.useState<SelectionState | null>(null);
  const [loading, setLoading] = React.useState(true);
  // Shared batch uploader (per-file progress, retry skips what landed) — one
  // batch for proofs, one for the final edits.
  const proofBatch = useUploadBatch(bookingId, 'proof');
  const finalBatch = useUploadBatch(bookingId, 'deliverable');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [delivered, setDelivered] = React.useState(false);

  /**
   * Final edits already registered on the server, from a session that ended
   * before the slide. The selection endpoint only knows about proofs, so
   * without this a creator who uploaded their finals and killed the app came
   * back to an empty dropzone and a DEAD slider — their work was on the
   * booking, invisible to them, and unreachable. Same family as the
   * uploaded-but-never-delivered hole, one screen over.
   */
  const [existingFinals, setExistingFinals] = React.useState(0);

  const load = React.useCallback(async () => {
    const { fetchSelectionApi, fetchMediaListingApi } = await import('../../lib/api');
    const [s, listing] = await Promise.all([
      fetchSelectionApi(bookingId),
      fetchMediaListingApi(bookingId),
    ]);
    setState(s);
    // A failed listing must not zero a real count — leave it as it was.
    if (listing) {
      setExistingFinals(listing.media.filter((m) => m.kind === 'deliverable' && !m.deleted).length);
    }
    setLoading(false);
  }, [bookingId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Waiting on the client: refresh so the lock appears without a re-open.
  React.useEffect(() => {
    if (!state || state.locked || !state.selection_deadline_at) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [state, load]);

  const uploadProofs = async () => {
    setBusy(true);
    setError(null);
    const failures = await proofBatch.uploadAll();
    if (failures === 0) proofBatch.reset();
    else setError(`${failures} file${failures === 1 ? '' : 's'} failed — retry sends only those.`);
    await load();
    setBusy(false);
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    const { proofsReadyApi } = await import('../../lib/api');
    const r = await proofsReadyApi(bookingId);
    if (!r || r.error) setError(r?.error ?? 'Could not publish — try again.');
    await load();
    setBusy(false);
  };

  const deliverFinal = async () => {
    setError(null);
    const { deliverApi } = await import('../../lib/api');
    const r = await deliverApi(bookingId);
    if (!r || 'error' in (r as object)) {
      setError((r as { error?: string })?.error ?? 'Delivery failed — try again.');
      return false;
    }
    setDelivered(true);
    finalBatch.reset();
    haptic('success'); // the client has their edit
    return true;
  };

  // Final edits sitting on the booking with no delivery behind them. Proofs
  // are deliberately excluded: they are published by their own act and the
  // client already sees them.
  const undelivered = !delivered && finalBatch.doneCount + existingFinals > 0;
  React.useEffect(() => {
    onUndeliveredChange?.(undelivered);
  }, [undelivered, onUndeliveredChange]);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.yellowDark} />
      </View>
    );
  }
  if (!state) {
    return (
      <View style={styles.centre}>
        <Text style={styles.waitSub}>Couldn't load the selection state — pull back and retry.</Text>
      </View>
    );
  }

  const photoProofs = state.proofs.filter((p) => !p.is_video);
  const videoProofs = state.proofs.filter((p) => p.is_video);
  const selected = state.proofs.filter((p) => p.selected);

  if (delivered) {
    return (
      <View style={styles.doneCard}>
        <View style={styles.doneIcon}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
        <Text style={styles.doneTitle}>Delivered</Text>
        <Text style={styles.waitSub}>
          The client has their edits. Your payout lands in Earnings once the review window closes.
        </Text>
      </View>
    );
  }

  // PHASE 3 — locked: edit the chosen set, deliver.
  if (state.locked) {
    return (
      <View>
        <Text style={styles.lead}>
          Selection locked — edit these {selected.length} picks and deliver them. Only the marked
          shots need full editing.
        </Text>
        <View style={styles.grid}>
          {state.proofs.map((p) => (
            <View key={p.id} style={[styles.cell, !p.selected && styles.cellDim]}>
              <Image source={{ uri: p.download_url }} style={styles.thumb} resizeMode="cover" />
              {p.selected && (
                <View style={styles.tickOn}>
                  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 12.5l4.5 4.5L19 7.5" stroke="#1A1A1A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </View>
              )}
            </View>
          ))}
        </View>
        <DeliverPanel
          batch={finalBatch}
          alreadyUploaded={existingFinals}
          promisedCount={selected.length}
          promisedLabel={`${selected.length} locked pick${selected.length === 1 ? '' : 's'}`}
          pickTitle="Add the final edits"
          pickSub="Full-resolution, unwatermarked — this is the delivery"
          slideLabel="Slide to deliver final edits"
          onDeliver={deliverFinal}
          error={error}
        />
      </View>
    );
  }

  // PHASE 2 — proofs published, client choosing.
  if (state.selection_deadline_at) {
    const ms = new Date(state.selection_deadline_at).getTime() - Date.now();
    const left = ms <= 0 ? 'any moment now' : `${Math.max(1, Math.round(ms / 3600_000))}h`;
    return (
      <View style={styles.waitCard}>
        <View style={styles.waitIcon}>
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="9" stroke="#8A6800" strokeWidth={1.8} />
            <Path d="M12 7.5V12l3 2" stroke="#8A6800" strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        </View>
        <Text style={styles.waitTitle}>Client is choosing</Text>
        <Text style={styles.waitSub}>
          Your {state.proofs.length} proofs are with the client. If they haven't chosen in {left},
          your first {included.photos} photos{included.videos > 0 ? ` and ${included.videos} video${included.videos > 1 ? 's' : ''}` : ''} lock
          automatically — upload order is your ranking.
        </Text>
      </View>
    );
  }

  // PHASE 1 — build the proof gallery.
  const enough = photoProofs.length >= included.photos && videoProofs.length >= included.videos;
  return (
    <View>
      <Text style={styles.lead}>
        Upload a proof set — watermarked or low-res exports, MORE than the bundle includes
        ({included.photos} photos{included.videos > 0 ? `, ${included.videos} videos` : ''}) so the
        client has a real choice. Upload in your preferred order: if they don't choose in time,
        your first picks are used.
      </Text>
      <Text style={styles.countLine}>
        {photoProofs.length} photo{photoProofs.length === 1 ? '' : 's'} · {videoProofs.length} video
        {videoProofs.length === 1 ? '' : 's'} uploaded
      </Text>
      <Pressable onPress={proofBatch.pick} disabled={proofBatch.uploading} style={styles.dropzone}>
        <Text style={styles.dropTitle}>
          {proofBatch.files.length > 0 ? `${proofBatch.files.length} file${proofBatch.files.length > 1 ? 's' : ''} ready to upload` : 'Add proofs'}
        </Text>
        <Text style={styles.dropSub}>JPG / MP4 exports — never the raw originals</Text>
      </Pressable>
      <BatchFileList batch={proofBatch} />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={{ gap: 10, marginTop: 14 }}>
        {proofBatch.files.length > 0 && (
          <Button
            title={
              proofBatch.uploading
                ? `Uploading ${proofBatch.doneCount + 1} of ${proofBatch.files.length}…`
                : proofBatch.failedCount > 0
                  ? `Retry ${proofBatch.failedCount} failed file${proofBatch.failedCount > 1 ? 's' : ''}`
                  : `Upload ${proofBatch.files.length} proof${proofBatch.files.length > 1 ? 's' : ''}`
            }
            disabled={busy}
            onPress={uploadProofs}
          />
        )}
        <Button
          title="Publish gallery — start client selection"
          variant={proofBatch.files.length > 0 ? 'ghost' : undefined}
          disabled={busy || !enough || proofBatch.files.length > 0}
          onPress={publish}
        />
        {!enough && (
          <Text style={styles.hint}>
            Upload at least {included.photos} photos{included.videos > 0 ? ` and ${included.videos} video${included.videos > 1 ? 's' : ''}` : ''} to publish.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { paddingVertical: 40, alignItems: 'center' },
  lead: { fontSize: 13, color: colors.grey, lineHeight: 19.5, marginBottom: 12 },
  countLine: { fontSize: 12.5, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  cell: { width: '23.5%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#EFEBE3' },
  cellDim: { opacity: 0.35 },
  thumb: { width: '100%', height: '100%' },
  tickOn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropzone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D9D5CC',
    borderRadius: 16,
    paddingVertical: 22,
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
  },
  dropTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  dropSub: { fontSize: 11.5, color: colors.grey },
  hint: { fontSize: 11.5, color: colors.grey, textAlign: 'center' },
  error: { fontSize: 12.5, fontWeight: '700', color: '#A32C2C', marginTop: 10, textAlign: 'center' },
  waitCard: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.yellowSoft,
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 22,
  },
  waitIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  waitSub: { fontSize: 12.5, color: colors.grey, lineHeight: 18.5, textAlign: 'center' },
  doneCard: { alignItems: 'center', gap: 8, paddingVertical: 26 },
  doneIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
});
