import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { Button } from '../ui/Button';
import { SlideToConfirm } from '../ui/SlideToConfirm';
import { colors } from '../../lib/theme';
import { extensionForContentType, extensionFromName } from '../../lib/mediaExtension';
import { captureHandledError } from '../../lib/sentry';

/**
 * THE creator upload pattern — the client's source-file uploader
 * (lib/rawUpload.ts) generalised to every media kind.
 *
 * Per-file progress, per-file status, per-file error text, and a retry that
 * skips files already done. The pattern it replaces looped fetch() calls
 * with no progress, aborted the whole batch on the first failure, and
 * re-uploaded every already-successful file on retry — registering duplicate
 * media rows each time. On our connections a 40-file upload WILL drop
 * midway; that must cost one file's retry, not the batch.
 */

/**
 * The extension for a picked asset, from three real signals in order of
 * trustworthiness — never a guess about the media kind.
 *
 * The mime→extension TABLE itself stays in lib/mediaExtension, which exists
 * to be the single copy of it; only the ordering lives here. `type` is the
 * picker's own image/video verdict and is the last resort before 'jpg', so an
 * asset that reports nothing else still cannot be named as the wrong kind.
 */
function assetExtension(a: {
  uri?: string | null;
  mimeType?: string | null;
  type?: string | null;
}): string {
  return (
    extensionForContentType(a.mimeType) ??
    // A picker URI can carry a query string; strip it before reading a suffix.
    extensionFromName((a.uri ?? '').split('?')[0]) ??
    (a.type === 'video' ? 'mp4' : 'jpg')
  );
}

/**
 * SOMETHING THE PICKER OFFERED THAT DID NOT BECOME A ROW.
 *
 * The client's uploader has had this since it was written (lib/store/upload
 * `RejectedFile`) and this one had nothing: an asset that never became a
 * file simply evaporated. `name` is null when the failure happened before
 * any asset was in hand — the picker itself refusing to open, say — which is
 * the one case that has no file to name.
 */
export interface DiscardedPick {
  name: string | null;
  reason: string;
}

export interface BatchFile {
  id: string;
  uri: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  status: 'queued' | 'uploading' | 'finishing' | 'done' | 'failed';
  /** 0–1, or null when the true total is unknowable (see rawUpload's put). */
  progress: number | null;
  error?: string;
  /** The registered row, once uploaded — what a removal names to the server. */
  mediaId?: string;
  /** A removal is in flight for this file; its control shows the wait. */
  removing?: boolean;
}

export function useUploadBatch(bookingId: string, kind: 'raw' | 'deliverable' | 'proof') {
  const [files, setFiles] = React.useState<BatchFile[]>([]);
  const [uploading, setUploading] = React.useState(false);
  // A live view of `files` for the async handlers. `remove` runs across an
  // await and must decide on what the list holds NOW, not on whatever it
  // held when the handler was created.
  const filesRef = React.useRef<BatchFile[]>(files);
  React.useEffect(() => {
    filesRef.current = files;
  }, [files]);
  /** Everything the picker offered that did not become a row, with reasons. */
  const [discarded, setDiscarded] = React.useState<DiscardedPick[]>([]);
  // A monotonic counter, because `Date.now()` alone can repeat within a
  // millisecond and two rows sharing an id would make every patch hit both.
  const seq = React.useRef(0);

  const patch = (id: string, p: Partial<BatchFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

  /**
   * NOTHING LEAVES THIS FUNCTION WITHOUT BEING SAID OUT LOUD.
   *
   * `pick` was an async function handed straight to onPress with no `try`
   * anywhere in it. Anything the picker threw — a permission refusal, a
   * relaunch before the previous sheet had dismissed, memory pressure on a
   * large multi-selection — became an unhandled promise rejection: no files
   * added, no error, no log, no Sentry event. The creator tapped, the sheet
   * closed, and the screen was exactly as before. That is the failure class
   * this project treats as the worst one available, and it is why picking a
   * second file appeared to do nothing.
   *
   * Every exit now either adds rows or records a DiscardedPick, and every
   * caught throw goes to Sentry as well as to the screen.
   */
  const pick = async () => {
    try {
      await pickInner();
    } catch (err) {
      captureHandledError(err, `deliverUploader:pick:${kind}`);
      setDiscarded((prev) => [
        ...prev,
        {
          name: null,
          reason:
            "Your photo library couldn't be opened. Check Snapt has photo access in Settings, then try again.",
        },
      ]);
    }
  };

  const pickInner = async () => {
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({
      /**
       * VIDEOS, EXPLICITLY. expo-image-picker's `mediaTypes` defaults to
       * 'images' (SDK 57 docs), and this call omitted it from the day the
       * file was written — so every creator upload surface built on this
       * hook has been photo-only since 2026-08-09, including the finished
       * edits for video products. A creator delivering a reel could not
       * select the thing they were paid to make.
       *
       * All three kinds this hook serves legitimately take video, which is
       * why the option belongs here rather than per-kind: deliverables are
       * the video product itself, raw is session footage (the server's own
       * refusal copy for it reads "…MP4 or MOV"), and proofs are checked
       * server-side against `image/*` or `video/*` with selection maths that
       * counts photo versus video.
       */
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled) return;
    // Not cancelled but nothing came back is not "nothing happened" — it is
    // the picker failing to hand anything over, and it has looked identical
    // to a successful pick of zero files.
    const assets = result.assets ?? [];
    if (assets.length === 0) {
      captureHandledError(
        new Error('picker returned no assets and did not report cancel'),
        `deliverUploader:pick_empty:${kind}`,
      );
      setDiscarded((prev) => [
        ...prev,
        { name: null, reason: 'Your library returned no files. Try selecting them again.' },
      ]);
      return;
    }

    // An asset with no usable uri cannot be read off the device later, and
    // adding it would produce a row that can only ever fail at upload time.
    // Refused HERE, by name, rather than silently or three screens later.
    const usable = assets.filter((a) => !!a.uri);
    if (usable.length < assets.length) {
      const lost = assets.filter((a) => !a.uri);
      captureHandledError(
        new Error(`${lost.length} of ${assets.length} picked assets had no uri`),
        `deliverUploader:pick_no_uri:${kind}`,
      );
      setDiscarded((prev) => [
        ...prev,
        ...lost.map((a) => ({
          name: a.fileName ?? null,
          reason: "Your library gave no readable file for this item — try re-saving it, or pick it again.",
        })),
      ]);
    }

    // Already in this batch. Uploading the same bytes twice would register
    // the file twice and deliver the client a duplicate, so it is dropped —
    // but said, because a silent drop is indistinguishable from the pick
    // having failed.
    const have = new Set(filesRef.current.map((f) => f.uri));
    const fresh = usable.filter((a) => !have.has(a.uri));
    if (fresh.length < usable.length) {
      setDiscarded((prev) => [
        ...prev,
        ...usable
          .filter((a) => have.has(a.uri))
          .map((a) => ({
            name: a.fileName ?? null,
            reason: 'Already in this delivery.',
          })),
      ]);
    }
    if (fresh.length === 0) return;

    setFiles((prev) => [
      ...prev,
      ...fresh.map((a) => ({
        id: `f${Date.now()}-${seq.current++}`,
        uri: a.uri,
        /**
         * The fallback extension is DERIVED, never assumed. It was a
         * hardcoded `.jpg`, which was harmless only while this picker could
         * not return videos — the line above just changed that. iOS returns
         * a null fileName routinely, and particularly for videos, and a
         * video called .jpg is the one file a photo library can never
         * accept: iOS reads photo-vs-video from the extension and hands
         * video bytes to UIImage, which refuses them. That is the exact
         * defect fixed on the client uploader in 6556402; enabling video
         * here without this would have re-shipped it on the delivery path,
         * where it lands in the paying client's camera roll.
         */
        name: a.fileName ?? `file-${Date.now()}-${seq.current}.${assetExtension(a)}`,
        mimeType: a.mimeType ?? undefined,
        sizeBytes: a.fileSize ?? undefined,
        status: 'queued' as const,
        progress: 0,
      })),
    ]);
  };

  /**
   * TAKE A FILE BACK OUT, up until the delivery is sent.
   *
   * A file that has not uploaded is local only, so it just leaves the list.
   * A file that HAS uploaded is registered against the booking, and dropping
   * it from the list alone would be a lie: /deliver reads the server's rows,
   * so the file the creator thought they removed would still reach the
   * client. Those go to the server first and only leave the list once it
   * confirms — and a refusal stays on the row, in the server's own words.
   *
   * Never throws and never silently no-ops: every exit either removes the
   * row or leaves a reason on it.
   */
  const remove = async (id: string) => {
    const target = filesRef.current.find((f) => f.id === id);
    if (!target) return;
    if (target.status !== 'done') {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      return;
    }
    if (!target.mediaId) {
      // Registered, but the register response did not name the row — without
      // an id the server cannot be told which file to drop, and removing it
      // locally would leave it in the delivery.
      patch(id, {
        error:
          "This file uploaded but can't be identified to remove. Reload the screen and try again.",
      });
      return;
    }
    patch(id, { removing: true, error: undefined });
    const { deleteBookingMedia } = await import('../../lib/api');
    const r = await deleteBookingMedia(bookingId, target.mediaId);
    if (r.ok) {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      return;
    }
    patch(id, { removing: false, error: r.error });
  };

  /**
   * Upload everything not yet done. Returns how many are still failing.
   *
   * THREE THINGS HERE ARE LOAD-BEARING, and their absence is what made this
   * uploader fail as total silence:
   *
   *  1. try/FINALLY around the flag. `uploading` was set true and cleared on
   *     the happy path only, so ANY throw — including the dynamic import on
   *     the line below — stranded it true forever. That one stuck boolean
   *     disabled the dropzone, the upload button and every remove control at
   *     once, with nothing on screen to explain it: the creator saw a dead
   *     panel and no error. Nothing may return from here without clearing it.
   *
   *  2. A per-file try/CATCH. One throw used to abandon the whole batch, so
   *     files 2..N never got a row, an error or a log — they simply never
   *     happened. A file's failure is now that file's failure.
   *
   *  3. A LIVE read of the list. The loop iterated a snapshot captured when
   *     the handler was created, so anything added while an upload ran was
   *     skipped and stayed 'queued' with no way to see why. It now walks by
   *     id against filesRef and re-reads each file's current state.
   */
  const uploadAll = async (): Promise<number> => {
    setUploading(true);
    let failures = 0;
    try {
      const { uploadBookingFile } = await import('../../lib/rawUpload');
      // Snapshot the IDS only. Which files exist is fixed for this run (a
      // file added mid-run gets the next tap), but each file's STATE is read
      // live, so one removed or already finished in the meantime is skipped
      // rather than re-uploaded.
      const ids = filesRef.current.map((f) => f.id);
      for (const id of ids) {
        const f = filesRef.current.find((x) => x.id === id);
        if (!f || f.status === 'done') continue;
        patch(f.id, { status: 'uploading', progress: 0, error: undefined });
        try {
          const r = await uploadBookingFile(
            bookingId,
            kind,
            { uri: f.uri, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes },
            (fraction) =>
              patch(
                f.id,
                // Bytes all handed off ≠ done: R2's ack + the register call are
                // still ahead. Same finishing phase as the client upload screen.
                fraction != null && fraction >= 1
                  ? { progress: 1, status: 'finishing' }
                  : { progress: fraction },
              ),
          );
          if (r.ok) {
            // The row id is what a later removal names to the server.
            patch(f.id, { status: 'done', progress: 1, mediaId: r.mediaId });
          } else {
            failures += 1;
            patch(f.id, { status: 'failed', error: r.error });
          }
        } catch (err) {
          // uploadBookingFile is written to RETURN its failures, so reaching
          // here means something genuinely unexpected — the file is still
          // marked failed, with a reason, and the batch carries on.
          captureHandledError(err, `deliverUploader:upload_file:${kind}`);
          failures += 1;
          patch(f.id, {
            status: 'failed',
            error: 'Something went wrong sending this file. Tap retry.',
          });
        }
      }
    } catch (err) {
      // Before the loop could start — the dynamic import is the realistic
      // case. Every unfinished file is marked, so the panel never sits
      // looking ready with nothing happening.
      captureHandledError(err, `deliverUploader:upload_batch:${kind}`);
      const stuck = filesRef.current.filter((f) => f.status !== 'done');
      failures += stuck.length;
      for (const f of stuck) {
        patch(f.id, {
          status: 'failed',
          error: "The uploader couldn't start. Check your connection and tap retry.",
        });
      }
    } finally {
      setUploading(false);
    }
    return failures;
  };

  const reset = () => {
    setFiles([]);
    setDiscarded([]);
  };
  /** Dismiss the discard notice — read and understood, not silently expired. */
  const clearDiscarded = () => setDiscarded([]);
  const doneCount = files.filter((f) => f.status === 'done').length;
  const failedCount = files.filter((f) => f.status === 'failed').length;
  const allDone = files.length > 0 && doneCount === files.length;

  return {
    files,
    pick,
    remove,
    uploadAll,
    reset,
    uploading,
    doneCount,
    failedCount,
    allDone,
    discarded,
    clearDiscarded,
  };
}

/** One file's row: name, live progress bar, status, error, remove. */
export function BatchFileList({
  batch,
}: {
  batch: ReturnType<typeof useUploadBatch>;
}) {
  if (batch.files.length === 0 && batch.discarded.length === 0) return null;
  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      {/* WHAT THE PICKER OFFERED THAT DID NOT BECOME A ROW. Without this an
          asset the uploader refused was indistinguishable from the pick never
          having happened — which is exactly how selecting several files could
          look like doing nothing at all.

          It lives HERE rather than in DeliverPanel because the Social proof
          uploader renders this list directly and never mounts the panel; put
          in the panel, proof picks would have gone on discarding silently. */}
      {batch.discarded.length > 0 && (
        <View style={styles.discardCard}>
          <Text style={styles.discardTitle}>
            {batch.discarded.length} {batch.discarded.length === 1 ? 'item was' : 'items were'} not
            added
          </Text>
          {batch.discarded.map((d, i) => (
            <Text key={`${d.name ?? 'item'}-${i}`} style={styles.discardLine}>
              • {d.name ? `${d.name} — ${d.reason}` : d.reason}
            </Text>
          ))}
          <Pressable onPress={batch.clearDiscarded} hitSlop={8}>
            <Text style={styles.discardDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      )}
      {batch.files.map((f) => (
        <View key={f.id} style={styles.fileRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {f.status === 'done' && (
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 12.5l4.5 4.5L19 7" stroke="#159A57" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              )}
              <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
            </View>
            {f.status === 'finishing' && <Text style={styles.finishing}>Finishing…</Text>}
            {(f.status === 'uploading' || f.status === 'finishing') && (
              <View style={styles.barTrack}>
                {/* Unknown total: an empty track and "Uploading…" beside it.
                    A bar that has to guess would be guessing about someone's
                    footage. */}
                {f.progress != null && (
                  <View style={[styles.barFill, { width: `${Math.round(f.progress * 100)}%` }]} />
                )}
              </View>
            )}
            {/* Keyed on the ERROR, not on `failed` — a removal that the
                server refuses leaves its reason on a row that is still
                `done`, and that reason has to be readable. */}
            {f.status === 'failed' ? (
              <Text style={styles.fileError}>{f.error ?? 'Upload failed.'}</Text>
            ) : f.error ? (
              <Text style={styles.fileError}>{f.error}</Text>
            ) : null}
          </View>
          {/* AVAILABLE UNTIL THE DELIVERY IS SENT — uploaded files included.
              An uploaded file is registered against the booking, so its X
              goes through the server (batch.remove) rather than just dropping
              a row; a file the creator removed must not still reach the
              client. Only a transfer in flight has no X: cancelling a
              part-written upload is a different control this uploader does
              not have, and a row that vanished mid-PUT would leave an object
              in the bucket that nothing points at. */}
          {f.status !== 'uploading' && f.status !== 'finishing' && (
            <Pressable
              onPress={() => void batch.remove(f.id)}
              disabled={f.removing}
              hitSlop={8}
              style={styles.removeBtn}
              accessibilityLabel={`Remove ${f.name}`}
            >
              {f.removing ? (
                <ActivityIndicator size="small" color={colors.grey} />
              ) : (
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.grey} strokeWidth={2.4} strokeLinecap="round" />
                </Svg>
              )}
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * The full deliberate act: pick → upload with progress → review against the
 * promise → slide to send. Used by remote delivery, in-person delivery and
 * revision re-delivery; Social's pipeline reuses the batch underneath.
 *
 * `promisedCount` is what the order committed to (source-file count for
 * remote, the locked selection for Social). Short of it → a warning, not a
 * block: the creator may legitimately combine files.
 *
 * UPLOADED IS NOT DELIVERED. Registering a file and delivering it are two
 * separate calls, and only the second one sets `delivered_at`, notifies the
 * client and makes anything downloadable. A creator who uploads and walks
 * away leaves a paying client with nothing — booking c8a63e3b, 2026-08-10 —
 * so the moment any file is on the server this panel stops reading as a
 * neutral "ready" state and says what is actually true.
 */
export function DeliverPanel({
  batch,
  alreadyUploaded = 0,
  promisedCount,
  promisedLabel,
  pickTitle,
  pickSub,
  slideLabel,
  notDeliveredNote = "These files are uploaded, but the client cannot see or download them yet. Nothing reaches them until you slide below.",
  onDeliver,
  error,
}: {
  batch: ReturnType<typeof useUploadBatch>;
  /** Deliverables registered on the server before this batch (e.g. an earlier session). */
  alreadyUploaded?: number;
  promisedCount?: number | null;
  promisedLabel?: string;
  pickTitle: string;
  pickSub: string;
  slideLabel: string;
  /** What "uploaded but not sent" means on THIS screen (a revision says something different). */
  notDeliveredNote?: string;
  onDeliver: () => Promise<boolean>;
  error?: string | null;
}) {
  const totalReady = batch.doneCount + alreadyUploaded;
  const short = promisedCount != null && promisedCount > 0 && totalReady < promisedCount;
  const readyToSend = totalReady > 0 && !batch.uploading && batch.failedCount === 0 && batch.files.every((f) => f.status === 'done');

  return (
    <View>
      <Pressable onPress={batch.pick} disabled={batch.uploading} style={styles.dropzone}>
        <Text style={styles.dropTitle}>
          {batch.files.length > 0
            ? `${batch.files.length} file${batch.files.length > 1 ? 's' : ''} in this delivery`
            : pickTitle}
        </Text>
        <Text style={styles.dropSub}>{pickSub}</Text>
      </Pressable>
      <BatchFileList batch={batch} />
      {batch.files.some((f) => f.status !== 'done') && (
        <View style={{ marginTop: 12 }}>
          <Button
            title={
              batch.uploading
                ? `Uploading ${batch.doneCount + 1} of ${batch.files.length}…`
                : batch.failedCount > 0
                  ? `Retry ${batch.failedCount} failed file${batch.failedCount > 1 ? 's' : ''}`
                  : `Upload ${batch.files.length} file${batch.files.length > 1 ? 's' : ''}`
            }
            disabled={batch.uploading || batch.files.length === 0}
            onPress={batch.uploadAll}
          />
          {batch.failedCount > 0 && !batch.uploading && (
            <Text style={styles.retryNote}>
              Files already uploaded are kept — retrying only sends the failed ones.
            </Text>
          )}
        </View>
      )}
      {/* Shown from the FIRST landed file, not only once the batch is clean:
          three uploaded and nine failed is still three files the client
          cannot see. */}
      {totalReady > 0 && (
        <View style={styles.notSentCard}>
          <Text style={styles.notSentTitle}>Uploaded — not delivered yet</Text>
          <Text style={styles.notSentBody}>{notDeliveredNote}</Text>
          <Text style={styles.reviewLine}>
            {totalReady} file{totalReady === 1 ? '' : 's'} uploaded
            {alreadyUploaded > 0 ? ` (${alreadyUploaded} from earlier)` : ''}
            {promisedCount != null && promisedCount > 0 ? ` · ${promisedLabel ?? `order includes ${promisedCount}`}` : ''}
          </Text>
          {short && (
            <Text style={styles.reviewWarn}>
              You're sending {totalReady} of {promisedCount} — deliver anyway only if that's
              intentional. The client sees exactly what arrives.
            </Text>
          )}
          {!readyToSend && (
            <Text style={styles.reviewWarn}>
              {batch.uploading
                ? 'Finish the upload, then slide to deliver.'
                : 'Retry the failed files above, then slide to deliver.'}
            </Text>
          )}
        </View>
      )}
      {!!error && <Text style={styles.deliverError}>{error}</Text>}
      <View style={{ marginTop: 14 }}>
        <SlideToConfirm label={slideLabel} disabled={!readyToSend} onConfirm={onDeliver} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dropzone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E2C97A',
    backgroundColor: '#FFFBF0',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  discardCard: {
    marginTop: 12,
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F6D5D2',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  discardTitle: { fontSize: 13, fontWeight: '800', color: colors.ink },
  discardLine: { fontSize: 12, color: '#8A3E36', lineHeight: 17 },
  discardDismiss: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    marginTop: 4,
    textDecorationLine: 'underline',
  },
  dropTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  dropSub: { fontSize: 12, color: '#8A7530', textAlign: 'center' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fileName: { fontSize: 12.5, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  fileError: { fontSize: 11.5, color: '#A32C2C', fontWeight: '600', marginTop: 3 },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: '#F0EBDF', marginTop: 7, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: colors.yellow },
  finishing: { fontSize: 10.5, fontWeight: '700', color: colors.greyWarm },
  removeBtn: { width: 26, height: 26, borderRadius: 8, backgroundColor: '#F5F3EE', alignItems: 'center', justifyContent: 'center' },
  retryNote: { fontSize: 11.5, color: colors.grey, textAlign: 'center', marginTop: 8 },
  notSentCard: {
    backgroundColor: colors.yellowSoft,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: colors.yellowSoftBorder,
    gap: 4,
  },
  notSentTitle: { fontSize: 13.5, fontWeight: '800', color: '#8A6800' },
  notSentBody: { fontSize: 12.5, color: '#8A6800', lineHeight: 18, fontWeight: '600' },
  reviewLine: { fontSize: 12.5, color: colors.grey },
  reviewWarn: { fontSize: 12, color: '#8A6800', fontWeight: '700', lineHeight: 17, marginTop: 4 },
  deliverError: { fontSize: 12.5, color: '#A32C2C', fontWeight: '600', marginTop: 12, textAlign: 'center' },
});
