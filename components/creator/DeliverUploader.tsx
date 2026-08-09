import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { Button } from '../ui/Button';
import { SlideToConfirm } from '../ui/SlideToConfirm';
import { colors } from '../../lib/theme';

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

export interface BatchFile {
  id: string;
  uri: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  progress: number;
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
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled) return;
    setFiles((prev) => [
      ...prev,
      ...result.assets.map((a, i) => ({
        id: `${Date.now()}-${i}`,
        uri: a.uri,
        name: a.fileName ?? `file-${Date.now()}-${i}.jpg`,
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
        (fraction) => patch(f.id, { progress: fraction }),
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
            {f.status === 'uploading' && (
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.round(f.progress * 100)}%` }]} />
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
 */
export function DeliverPanel({
  batch,
  alreadyUploaded = 0,
  promisedCount,
  promisedLabel,
  pickTitle,
  pickSub,
  slideLabel,
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
      {readyToSend && (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewTitle}>Ready to send</Text>
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
  removeBtn: { width: 26, height: 26, borderRadius: 8, backgroundColor: '#F5F3EE', alignItems: 'center', justifyContent: 'center' },
  retryNote: { fontSize: 11.5, color: colors.grey, textAlign: 'center', marginTop: 8 },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#EFEDE7',
    gap: 4,
  },
  reviewTitle: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  reviewLine: { fontSize: 12.5, color: colors.grey },
  reviewWarn: { fontSize: 12, color: '#8A6800', fontWeight: '700', lineHeight: 17, marginTop: 4 },
  deliverError: { fontSize: 12.5, color: '#A32C2C', fontWeight: '600', marginTop: 12, textAlign: 'center' },
});
