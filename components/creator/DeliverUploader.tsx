import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { Button } from '../ui/Button';
import { SlideToConfirm } from '../ui/SlideToConfirm';
import { colors } from '../../lib/theme';
import { extensionForContentType, extensionFromName } from '../../lib/mediaExtension';

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
}

export function useUploadBatch(bookingId: string, kind: 'raw' | 'deliverable' | 'proof') {
  const [files, setFiles] = React.useState<BatchFile[]>([]);
  const [uploading, setUploading] = React.useState(false);

  const patch = (id: string, p: Partial<BatchFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const pick = async () => {
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
    setFiles((prev) => [
      ...prev,
      ...result.assets.map((a, i) => ({
        id: `${Date.now()}-${i}`,
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
        name: a.fileName ?? `file-${Date.now()}-${i}.${assetExtension(a)}`,
        mimeType: a.mimeType ?? undefined,
        sizeBytes: a.fileSize ?? undefined,
        status: 'queued' as const,
        progress: 0,
      })),
    ]);
  };

  const remove = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  /** Upload everything not yet done. Returns how many are still failing. */
  const uploadAll = async (): Promise<number> => {
    setUploading(true);
    const { uploadBookingFile } = await import('../../lib/rawUpload');
    let failures = 0;
    for (const f of files) {
      if (f.status === 'done') continue;
      patch(f.id, { status: 'uploading', progress: 0, error: undefined });
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
        patch(f.id, { status: 'done', progress: 1 });
      } else {
        failures += 1;
        patch(f.id, { status: 'failed', error: r.error });
      }
    }
    setUploading(false);
    return failures;
  };

  const reset = () => setFiles([]);
  const doneCount = files.filter((f) => f.status === 'done').length;
  const failedCount = files.filter((f) => f.status === 'failed').length;
  const allDone = files.length > 0 && doneCount === files.length;

  return { files, pick, remove, uploadAll, reset, uploading, doneCount, failedCount, allDone };
}

/** One file's row: name, live progress bar, status, error, remove. */
export function BatchFileList({
  batch,
}: {
  batch: ReturnType<typeof useUploadBatch>;
}) {
  if (batch.files.length === 0) return null;
  return (
    <View style={{ gap: 8, marginTop: 12 }}>
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
            {f.status === 'failed' && (
              <Text style={styles.fileError}>{f.error ?? 'Upload failed.'}</Text>
            )}
          </View>
          {f.status !== 'uploading' && f.status !== 'done' && !batch.uploading && (
            <Pressable onPress={() => batch.remove(f.id)} hitSlop={8} style={styles.removeBtn}>
              <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                <Path d="M6 6l12 12M18 6L6 18" stroke={colors.grey} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
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
