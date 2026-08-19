import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import {
  MAX_FILES,
  MAX_IMAGE_MB,
  MAX_TOTAL_GB,
  MAX_VIDEO_MB,
  useUpload,
  type RejectedFile,
} from '../../lib/store/upload';
import { colors, insetBottom } from '../../lib/theme';
import { extensionForContentType, extensionFromName } from '../../lib/mediaExtension';

/**
 * The extension for a picked asset whose `fileName` iOS did not supply.
 *
 * Three sources, most trustworthy first — and none of them a guess about the
 * media KIND, which is the mistake being fixed:
 *
 *  1. the picker's own mime type, which is what the server validates against
 *     its allowlist and what the download path will later believe;
 *  2. the extension on the local picker URI, which is a real file on disk;
 *  3. the asset's declared type, which distinguishes video from image even
 *     when nothing else survived. `livePhoto`/`pairedVideo` are treated as
 *     images: the still is what gets uploaded.
 *
 * Only if all three say nothing does this fall back to 'jpg' — and by then
 * the server's ACCEPTED_MIME check is the backstop, because a file whose
 * content type is unknown is refused at presign time anyway.
 */
function fallbackExtension(asset: {
  uri?: string | null;
  mimeType?: string | null;
  type?: string | null;
}): string {
  return (
    extensionForContentType(asset.mimeType) ??
    // The URI can carry a query string; strip it before reading the suffix.
    extensionFromName((asset.uri ?? '').split('?')[0]) ??
    (asset.type === 'video' ? 'mp4' : 'jpg')
  );
}

/**
 * How many files move at once. Serial wastes a connection that can carry
 * more; unbounded makes fifteen progress bars all crawl and starves the
 * checkout requests the client is about to make. Three is the compromise.
 */
const UPLOAD_CONCURRENCY = 3;

/**
 * Every size on this screen renders through here. The per-file values are
 * stored at one decimal, but SUMMING them reintroduces binary float tails —
 * 4.3 + 4.3 is 8.600000000000001, and that string went straight onto the
 * screen as "8.6000000000000001MB of 1.5GB".
 */
const fmtSize = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)}GB` : `${Math.round(mb * 10) / 10}MB`;

export default function UploadFootage() {
  const router = useRouter();
  const { files, note, draftId, setNote, addPicked, removeFile, setFileStatus, setDraftId, adoptDraftFiles } =
    useUpload();
  const [rejected, setRejected] = React.useState<RejectedFile[]>([]);
  // The picker copies every selected asset into the app's cache before we
  // ever see a uri, so a phone that is truly out of storage fails HERE —
  // and used to fail as an unhandled rejection, showing nothing at all.
  const [pickError, setPickError] = React.useState<string | null>(null);
  // Files restored from an earlier visit, until the client says keep or
  // start over. Never silently folded into what looks like a fresh order.
  const [restored, setRestored] = React.useState<number>(0);
  const [discarding, setDiscarding] = React.useState(false);

  // One abort handle per file, so removing a thumbnail stops that transfer
  // and only that one. Held in a ref: aborting is not a render concern.
  const aborts = React.useRef<Map<string, AbortController>>(new Map());

  /**
   * COME BACK AND YOUR FILES ARE STILL THERE.
   *
   * Uploading on selection means an abandoned checkout leaves real footage
   * on the server. Making the client send it a second time would waste the
   * exact thing this change was built to save. So the draft is restored —
   * but announced, because silently attaching last night's files to what
   * the client thinks is a new order is the worse failure.
   */
  React.useEffect(() => {
    if (files.length > 0) return; // mid-flow; nothing to restore over
    let cancelled = false;
    (async () => {
      const { apiConfigured, fetchCurrentDraft } = await import('../../lib/api');
      if (!apiConfigured) return;
      const draft = await fetchCurrentDraft();
      if (cancelled || !draft?.draft_id || draft.files.length === 0) return;
      setDraftId(draft.draft_id);
      adoptDraftFiles(
        draft.files.map((f) => ({ mediaId: f.id, name: f.name, contentType: f.content_type })),
      );
      setRestored(draft.files.length);
    })();
    return () => {
      cancelled = true;
    };
    // Mount only: re-running after a pick would fight the live batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Upload one file, start to finish, reporting into the store as it goes. */
  const uploadOne = React.useCallback(
    async (file: { id: string; uri?: string; name?: string; mimeType?: string; sizeMb: number }, draft: string) => {
      if (!file.uri) return;
      const controller = new AbortController();
      aborts.current.set(file.id, controller);
      setFileStatus(file.id, { status: 'uploading', progress: 0, error: undefined });
      const { uploadDraftFile } = await import('../../lib/rawUpload');
      const r = await uploadDraftFile(
        draft,
        {
          uri: file.uri,
          name: file.name ?? 'upload.jpg',
          mimeType: file.mimeType,
          sizeBytes: Math.round(file.sizeMb * 1048576),
        },
        (fraction) => setFileStatus(file.id, { progress: fraction }),
        controller.signal,
      );
      aborts.current.delete(file.id);
      // A cancel is the client's own doing — the row is already gone from
      // the store, and showing it as "failed" would invite a retry of a
      // file they just deleted.
      if (r.aborted) return;
      if (r.ok) setFileStatus(file.id, { status: 'done', progress: 1, mediaId: r.mediaId });
      else setFileStatus(file.id, { status: 'failed', error: r.error });
    },
    [setFileStatus],
  );

  /** Run a queue with a small pool rather than all at once. */
  const runQueue = React.useCallback(
    async (queued: typeof files, draft: string) => {
      let next = 0;
      const worker = async () => {
        while (next < queued.length) {
          const f = queued[next++];
          await uploadOne(f, draft);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queued.length) }, worker),
      );
    },
    [uploadOne],
  );

  // The picker is real in every mode — it reads files off the device and
  // does not need a server. UPLOADING needs one, and now starts here rather
  // than after payment, so the transfer overlaps package and style.
  const pick = async () => {
    setRejected([]);
    setPickError(null);
    const ImagePicker = await import('expo-image-picker');
    let result: Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_FILES,
        quality: 1,
      });
    } catch (err) {
      // The real reason goes to Sentry; the message here is the one honest
      // use of "storage" on this screen, because copying into the cache is
      // the only step that actually needs free space on the phone.
      const { captureHandledError } = await import('../../lib/sentry');
      captureHandledError(err, 'upload:pick');
      setPickError(
        "Couldn't load that selection from your phone. If its storage is almost full, free some space and try again — otherwise just try again.",
      );
      return;
    }
    if (result.canceled) return;
    const before = useUpload.getState().files.map((f) => f.id);
    const bad = addPicked(
      result.assets.map((a, i) => ({
        uri: a.uri,
        // The fallback name's extension is DERIVED, never assumed. iOS
        // routinely returns a null fileName for videos, and the old
        // hardcoded `.jpg` here is what made those videos impossible to save
        // back to a photo library later — iOS picks image-vs-video from the
        // extension, so video bytes called .jpg take the image branch and
        // are refused. See lib/mediaExtension.
        name: a.fileName ?? `upload-${Date.now()}-${i}.${fallbackExtension(a)}`,
        mimeType: a.mimeType ?? undefined,
        sizeMb: Math.round(((a.fileSize ?? 0) / 1048576) * 10) / 10,
      })),
    );
    setRejected(bad);

    const { apiConfigured, createUploadDraft } = await import('../../lib/api');
    if (!apiConfigured) return;
    // Whatever addPicked actually accepted — never the raw picker result,
    // which still contains the files the caps rejected.
    const accepted = useUpload.getState().files.filter((f) => !before.includes(f.id) && f.uri);
    if (accepted.length === 0) return;
    let draft = useUpload.getState().draftId;
    if (!draft) {
      draft = await createUploadDraft();
      if (!draft) {
        for (const f of accepted) {
          setFileStatus(f.id, { status: 'failed', error: "Couldn't start the upload." });
        }
        return;
      }
      setDraftId(draft);
    }
    void runQueue(accepted, draft);
  };

  /**
   * Removing a file cancels its transfer and cleans up whatever landed. The
   * abort stops the PUT, but an aborted PUT can still have completed on the
   * far side, so the server delete runs either way — it is a no-op when
   * there is nothing there.
   */
  const remove = async (id: string) => {
    const file = files.find((f) => f.id === id);
    aborts.current.get(id)?.abort();
    aborts.current.delete(id);
    removeFile(id);
    if (!file) return;
    const draft = useUpload.getState().draftId;
    if (!draft) return;
    const { apiConfigured, deleteDraftFile } = await import('../../lib/api');
    if (!apiConfigured) return;
    if (file.mediaId) {
      await deleteDraftFile(draft, file.mediaId);
      return;
    }
    // Cancelled mid-flight: no row id, because registration never ran. The
    // object (if the PUT finished) has no row pointing at it, so the
    // abandoned-draft sweep is what collects it.
  };

  /** Retry one failed file. Files already done are never touched. */
  const retry = async (id: string) => {
    const file = files.find((f) => f.id === id);
    const draft = useUpload.getState().draftId;
    if (!file || !draft) return;
    await uploadOne(file, draft);
  };

  /** "Start over" on a restored draft — discard the lot, server included. */
  const startOver = async () => {
    const draft = useUpload.getState().draftId;
    setDiscarding(true);
    if (draft) {
      const { apiConfigured, discardUploadDraft } = await import('../../lib/api');
      if (apiConfigured) await discardUploadDraft(draft);
    }
    useUpload.getState().reset();
    setRestored(0);
    setDiscarding(false);
  };

  const uploading = files.filter((f) => f.status === 'uploading' || f.status === 'queued').length;
  const failed = files.filter((f) => f.status === 'failed').length;

  const rejectLine = (r: RejectedFile) =>
    r.reason === 'count'
      ? `${r.name} — not added, ${MAX_FILES} files is the maximum per order`
      : r.reason === 'type'
        ? `${r.name} — unsupported file type`
        : r.reason === 'size'
          ? `${r.name} — over the ${MAX_IMAGE_MB}MB image / ${MAX_VIDEO_MB}MB video limit`
          : `${r.name} — would exceed the ${MAX_TOTAL_GB}GB total`;
  const atLimit = files.length >= MAX_FILES;
  const totalMb = files.reduce((s, f) => s + f.sizeMb, 0);
  const usage = fmtSize(totalMb);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Upload footage" />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Send us your raw photos or video and we'll make them shine. Up to {MAX_FILES} files per
          order.
        </Text>

        {restored > 0 && (
          <View style={styles.restoredCard}>
            <Text style={styles.restoredTitle}>
              {restored} {restored === 1 ? 'file' : 'files'} from earlier are still here
            </Text>
            <Text style={styles.restoredBody}>
              You added these before and they finished uploading, so there's no need to send them
              again. Carry on, or clear them and start fresh.
            </Text>
            <View style={styles.restoredRow}>
              <Pressable onPress={() => setRestored(0)} style={styles.restoredKeep}>
                <Text style={styles.restoredKeepLabel}>Keep them</Text>
              </Pressable>
              <Pressable onPress={startOver} disabled={discarding} style={styles.restoredClear}>
                <Text style={styles.restoredClearLabel}>
                  {discarding ? 'Clearing…' : 'Start over'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {!atLimit ? (
          <Pressable onPress={pick} style={styles.dropzone}>
            <View style={styles.dropIcon}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M5 15v3a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 18v-3" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </View>
            <Text style={styles.dropTitle}>Add photos or video</Text>
            <Text style={styles.dropSub}>
              JPG, PNG, HEIC, MP4, MOV · {MAX_IMAGE_MB}MB per image, {MAX_VIDEO_MB}MB per video ·{' '}
              {MAX_TOTAL_GB}GB total
            </Text>
          </Pressable>
        ) : (
          <View style={styles.limitCard}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M12 3a9 9 0 100 18 9 9 0 000-18z" stroke={colors.error} strokeWidth={1.8} />
              <Path d="M12 7.5V13" stroke={colors.error} strokeWidth={1.8} strokeLinecap="round" />
              <Path d="M12 15.5v.01" stroke={colors.error} strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
            <View style={{ flex: 1 }}>
              <Text style={styles.limitTitle}>You've reached the {MAX_FILES}-file limit per order</Text>
              <Text style={styles.limitSub}>
                {MAX_FILES} files is the maximum for a single order. Have more? Place a second
                order for the rest once this one's in.
              </Text>
            </View>
          </View>
        )}

        <View style={styles.countRow}>
          <Text style={styles.countLabel}>
            {files.length} {files.length === 1 ? 'file' : 'files'} added
          </Text>
          <Text style={styles.usageLabel}>
            {usage} of {MAX_TOTAL_GB}GB
          </Text>
        </View>
        {pickError && (
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Nothing was added</Text>
            <Text style={styles.rejectLine}>{pickError}</Text>
          </View>
        )}
        {rejected.length > 0 && (
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>
              {rejected.length} {rejected.length === 1 ? 'file was' : 'files were'} not added
            </Text>
            {rejected.map((r, i) => (
              <Text key={`${r.name}-${i}`} style={styles.rejectLine}>
                • {rejectLine(r)}
              </Text>
            ))}
          </View>
        )}

        {files.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No files yet</Text>
            <Text style={styles.emptyBody}>
              Add the photos or video you want edited. They start uploading straight away, so
              they're ready by the time you've picked a package — and only your assigned editor can
              see them.
            </Text>
          </View>
        ) : (
        <View style={styles.grid}>
          {files.map((f) => (
            <View key={f.id} style={[styles.thumb, { backgroundColor: f.tint }]}>
              {f.thumb && (
                <Image source={f.thumb} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              )}

              {/* Per-file state, over its own thumbnail — one file failing
                  says nothing about the other fourteen. */}
              {f.status === 'uploading' && (
                <View style={styles.thumbOverlay}>
                  {/* progress == null means the true total is unknowable for
                      this file — an empty track and an ellipsis, never a
                      percentage we would be making up. */}
                  <View style={styles.thumbBarTrack}>
                    {f.progress != null && (
                      <View style={[styles.thumbBarFill, { width: `${Math.round(f.progress * 100)}%` }]} />
                    )}
                  </View>
                  <Text style={styles.thumbPct}>
                    {f.progress != null ? `${Math.round(f.progress * 100)}%` : 'Uploading…'}
                  </Text>
                </View>
              )}
              {f.status === 'failed' && (
                <Pressable onPress={() => retry(f.id)} style={styles.thumbFailed}>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path d="M4 12a8 8 0 018-8c2.8 0 5.2 1.4 6.6 3.6M20 12a8 8 0 01-8 8c-2.8 0-5.2-1.4-6.6-3.6M18 4.5v3.2h-3.2M6 19.5v-3.2h3.2" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={styles.thumbFailedLabel}>Tap to retry</Text>
                </Pressable>
              )}
              {f.status === 'done' && (
                <View style={styles.thumbDone}>
                  <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </View>
              )}

              <Pressable onPress={() => remove(f.id)} style={styles.removeBtn} hitSlop={6}>
                <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
                </Svg>
              </Pressable>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeLabel}>{f.type}</Text>
              </View>
              {f.sizeMb > 0 && (
                <View style={styles.sizeBadge}>
                  <Text style={styles.sizeBadgeLabel}>{fmtSize(f.sizeMb)}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
        )}
        {failed > 0 && (
          <Text style={styles.failedNote}>
            {failed} {failed === 1 ? 'file' : 'files'} didn't upload — tap a marked thumbnail to
            retry it. The ones that finished are kept.
          </Text>
        )}

        <Text style={styles.noteTitle}>Anything we should know?</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Please keep the warm tones, and crop out the background clutter."
          placeholderTextColor="#9A9A9A"
          multiline
          style={styles.noteInput}
        />
        <View style={{ height: 24 }} />
      </KeyboardScrollView>
      <View style={styles.footer}>
        {/* Continue is never gated on the upload — the whole point is that
            choosing a package happens WHILE the transfer runs. Payment is
            where an incomplete file actually matters, and pricing.tsx holds
            that line. */}
        <Text style={styles.footerCount}>
          {uploading > 0
            ? `${uploading} of ${files.length}${'\n'}uploading`
            : failed > 0
              ? `${failed} ${failed === 1 ? 'file' : 'files'}${'\n'}need a retry`
              : `${files.length} ${files.length === 1 ? 'file' : 'files'}${'\n'}ready`}
        </Text>
        <Pressable
          onPress={() => files.length > 0 && router.push('/upload/packages')}
          disabled={files.length === 0}
          style={[styles.cta, files.length === 0 && { opacity: 0.45 }]}
        >
          <Text style={styles.ctaLabel}>Continue</Text>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M5 12h14M13 6l6 6-6 6" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  lead: { fontSize: 14, color: colors.grey, lineHeight: 20, marginBottom: 18 },
  dropzone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E2C97A',
    backgroundColor: '#FFFBF0',
    borderRadius: 16,
    paddingVertical: 26,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  dropIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  dropSub: { fontSize: 12, color: '#8A7530' },
  limitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: '#F1DADA',
    backgroundColor: '#FDF3F3',
    borderRadius: 16,
    padding: 18,
    paddingHorizontal: 16,
  },
  limitTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  limitSub: { fontSize: 12.5, color: colors.grey, marginTop: 3, lineHeight: 17 },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 12,
  },
  countLabel: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  usageLabel: { fontSize: 12, color: colors.grey, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb: {
    width: '31%',
    flexGrow: 1,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    maxWidth: '32%',
  },
  typeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(26,26,26,0.75)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeLabel: { fontSize: 9, fontWeight: '700', color: '#fff' },
  sizeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(26,26,26,0.6)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  sizeBadgeLabel: { fontSize: 8.5, fontWeight: '700', color: '#fff' },
  thumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26,26,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  thumbBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  thumbBarFill: { height: '100%', borderRadius: 2, backgroundColor: colors.yellow },
  thumbPct: { fontSize: 11, fontWeight: '800', color: '#fff' },
  thumbFailed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(163,44,44,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  thumbFailedLabel: { fontSize: 10, fontWeight: '800', color: '#fff' },
  thumbDone: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#159A57',
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedNote: {
    fontSize: 12,
    color: '#8C3A2E',
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 10,
  },
  restoredCard: {
    borderWidth: 1.5,
    borderColor: colors.yellowSoftBorder,
    backgroundColor: colors.yellowSoft,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 5,
  },
  restoredTitle: { fontSize: 13.5, fontWeight: '800', color: '#8A6800' },
  restoredBody: { fontSize: 12.5, color: '#8A6800', lineHeight: 18 },
  restoredRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  restoredKeep: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoredKeepLabel: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
  restoredClear: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E2C97A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoredClearLabel: { fontSize: 12.5, fontWeight: '800', color: '#8A6800' },
  rejectCard: {
    borderWidth: 1,
    borderColor: '#F1DADA',
    backgroundColor: '#FDF3F3',
    borderRadius: 14,
    padding: 13,
    marginBottom: 12,
    gap: 3,
  },
  rejectTitle: { fontSize: 13, fontWeight: '800', color: '#A32C2C' },
  rejectLine: { fontSize: 12, color: '#8C3A2E', lineHeight: 17 },
  emptyCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 5,
  },
  emptyTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  emptyBody: { fontSize: 12.5, color: colors.grey, lineHeight: 18, textAlign: 'center' },
  removeBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(26,26,26,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 24, marginBottom: 10 },
  noteInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#ECECEC',
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: '#fff',
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  footerCount: { fontSize: 12.5, color: colors.grey, lineHeight: 16 },
  cta: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
});
