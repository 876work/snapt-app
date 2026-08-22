import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { Text } from '../../lib/text';
import { DeliverPanel, useUploadBatch } from './DeliverUploader';
import type { JobOffer } from '../../lib/store/creator';
import { EDIT_STYLES, REMOTE_PACKAGES } from '../../lib/store/upload';
import { colors } from '../../lib/theme';
import { offerSettings, photoFilename, saveToPhotos } from '../../lib/saveToPhotos';
import { haptic } from '../../lib/haptics';

/**
 * A remote edit order is a DESK job, and this is its screen: what was
 * ordered, the client's source files, the deadline, and one deliberate
 * Deliver act. It replaced a flow where the only path to Deliver was the
 * in-person choreography — "I'm on my way", check-in, asking the client to
 * read out a safety code for a session that doesn't exist. The server now
 * refuses check-in on remote bookings, so this screen is the only path.
 */

interface SourceFile {
  id: string;
  name: string;
  contentType: string | null;
  url: string;
  isImage: boolean;
}

export function RemoteJob({
  job,
  onUndeliveredChange,
}: {
  job: JobOffer;
  /** Files landed, delivery not sent — the parent screen guards the exit on it. */
  onUndeliveredChange?: (undelivered: boolean) => void;
}) {
  const router = useRouter();
  const batch = useUploadBatch(job.id, 'deliverable');

  const [sources, setSources] = React.useState<SourceFile[] | null>(null);
  const [existingFinals, setExistingFinals] = React.useState(0);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [dueAt, setDueAt] = React.useState<string | null>(null);
  const [clockState, setClockState] = React.useState<'on_track' | 'approaching' | 'late' | null>(null);
  const [delivered, setDelivered] = React.useState(!!job.deliveredAt);
  const [deliverError, setDeliverError] = React.useState<string | null>(null);
  const [openRevision, setOpenRevision] = React.useState<{ id: string; details: string } | null>(null);
  const [savedIds, setSavedIds] = React.useState<Set<string>>(new Set());
  const [saveNote, setSaveNote] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = await import('../../lib/api');
      if (!api.apiConfigured) return;
      setLoadFailed(false);
      const [listing, deliveries, revs] = await Promise.all([
        api.fetchMediaListingApi(job.id),
        api.fetchMyDeliveries(),
        api.fetchRevisionsApi(job.id),
      ]);
      if (cancelled) return;
      if (!listing) {
        setLoadFailed(true);
        return;
      }
      setSources(
        listing.media
          .filter((m) => m.kind === 'raw' && !m.deleted && m.download_url)
          .map((m) => ({
            id: m.id,
            name:
              m.storage_path?.split('/').pop()?.replace(/^\d+-/, '') ??
              m.download_url!.split('/').pop()?.split('?')[0]?.replace(/^\d+-/, '') ??
              'file',
            contentType: m.content_type,
            url: m.download_url!,
            isImage: (m.content_type ?? '').startsWith('image/'),
          })),
      );
      setExistingFinals(listing.media.filter((m) => m.kind === 'deliverable' && !m.deleted).length);
      const mine = deliveries?.open?.find((d) => d.booking_id === job.id);
      setDueAt(mine?.due_at ?? null);
      setClockState(mine?.state ?? null);
      const open = revs?.find((r) => r.status === 'open');
      setOpenRevision(open ? { id: open.id, details: open.details } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id, reloadKey, delivered]);

  // On a revision round the previous delivery is already with the client, so
  // only THIS batch is unsent; on a first delivery the finals registered by an
  // earlier, abandoned attempt count too — they are exactly what the client
  // is missing.
  const undelivered = openRevision
    ? batch.doneCount > 0
    : !delivered && batch.doneCount + existingFinals > 0;
  React.useEffect(() => {
    onUndeliveredChange?.(undelivered);
  }, [undelivered, onUndeliveredChange]);

  /**
   * DOWNLOADING IS NOT INSTANT AND MUST NOT LOOK IT.
   *
   * A source file is the client's camera original — hundreds of megabytes on
   * a video order, over a Caribbean uplink. This showed nothing at all while
   * that ran: the arrow stayed an arrow, so the only readings available were
   * "the button is broken" or "it finished instantly", and the natural
   * response to either is tapping again — which starts the whole transfer a
   * second time.
   *
   * Three distinct states now, per file: in progress (spinner, and the tap
   * is refused rather than queued), complete (green check, the existing
   * savedIds), and failed (the file's own row goes red and carries the
   * reason). Failure is deliberately NOT the same shape as either other
   * state, which is the whole point of the previous fix on this path.
   */
  const [downloadingIds, setDownloadingIds] = React.useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = React.useState<Record<string, string>>({});

  const saveSource = async (f: SourceFile) => {
    // A second tap while the first transfer is running would download the
    // same file twice over a link that is already the bottleneck.
    if (downloadingIds.has(f.id)) return;
    setSaveNote(null);
    setSaveErrors((prev) => {
      if (!prev[f.id]) return prev;
      const next = { ...prev };
      delete next[f.id];
      return next;
    });
    setDownloadingIds((prev) => new Set(prev).add(f.id));
    const index = (sources ?? []).findIndex((s) => s.id === f.id);
    const result = await saveToPhotos({
      url: f.url,
      filename: photoFilename({
        subject: job.occasion,
        date: job.when,
        index: index >= 0 ? index + 1 : undefined,
        originalName: f.name,
        contentType: f.contentType,
      }),
      // Signed links last an hour and this listing was fetched on mount, so
      // an expired URL is the ordinary case on a job left open. Re-listing
      // re-presigns everything; find this file again by id.
      refreshUrl: async () => {
        const api = await import('../../lib/api');
        const listing = await api.fetchMediaListingApi(job.id);
        const fresh = listing?.media.find((m) => m.id === f.id && !m.deleted);
        if (fresh?.download_url) {
          setSources((prev) =>
            (prev ?? []).map((s) => (s.id === f.id ? { ...s, url: fresh.download_url! } : s)),
          );
        }
        return fresh?.download_url ?? null;
      },
      context: 'creator_source',
    });
    // Whatever happened, this file is no longer in flight — cleared before
    // the branch so no exit can leave a spinner running forever.
    setDownloadingIds((prev) => {
      const next = new Set(prev);
      next.delete(f.id);
      return next;
    });
    if (result.ok) {
      setSavedIds((prev) => new Set(prev).add(f.id));
      return;
    }
    // On the file's own row, so a creator with several sources can see WHICH
    // one failed — the shared note below could not say.
    setSaveErrors((prev) => ({ ...prev, [f.id]: result.message }));
    offerSettings(result);
  };

  const deliverFinal = async () => {
    setDeliverError(null);
    const api = await import('../../lib/api');
    if (openRevision) {
      const r = await api.deliverRevisionApi(job.id, openRevision.id);
      if (r && 'error' in (r as object)) {
        setDeliverError((r as { error?: string }).error ?? 'Delivery failed — try again.');
        return false;
      }
      setOpenRevision(null);
      batch.reset();
      haptic('success'); // the revision reached the client
      return true;
    }
    const r = await api.deliverApi(job.id);
    if (!r || 'error' in (r as object)) {
      setDeliverError((r as { error?: string })?.error ?? 'Delivery failed — try again.');
      return false;
    }
    setDelivered(true);
    batch.reset();
    haptic('success'); // the client has their edit
    return true;
  };

  const pkg = job.remoteTier
    ? REMOTE_PACKAGES[job.mediaKind ?? 'photo']?.find((p) => p.tier === job.remoteTier)
    : undefined;
  // Resolved through the known style list rather than printed raw, so an
  // unrecognised id renders nothing instead of arbitrary stored text.
  const style = job.editStyle ? EDIT_STYLES.find((e) => e.id === job.editStyle) : undefined;

  const deadlineCard = dueAt ? (
    <View
      style={[
        styles.deadlineCard,
        clockState === 'late' && styles.deadlineLate,
        clockState === 'approaching' && styles.deadlineWarn,
      ]}
    >
      <Text style={[styles.deadlineTitle, clockState === 'late' && { color: '#B4231F' }]}>
        {clockState === 'late' ? 'This delivery is overdue' : 'Delivery deadline'}
      </Text>
      <Text style={styles.deadlineWhen}>
        {new Date(dueAt).toLocaleString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })}
        {job.rush ? ' · rush order' : ''}
      </Text>
    </View>
  ) : null;

  return (
    <View>
      {/* What was ordered */}
      <View style={styles.orderCard}>
        <Text style={styles.orderLabel}>THE ORDER</Text>
        <Text style={styles.orderName}>{pkg?.name ?? 'Remote edit'}</Text>
        {!!pkg?.desc && <Text style={styles.orderDesc}>{pkg.desc}</Text>}
        {style && (
          <View style={styles.styleRow}>
            <View style={[styles.styleDot, { backgroundColor: style.tint }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.styleName}>{style.name}</Text>
              <Text style={styles.styleDesc}>{style.desc}</Text>
            </View>
          </View>
        )}
      </View>

      {!delivered && deadlineCard}

      {/* The client's source files — the material this job is edited from. */}
      <Text style={styles.sectionTitle}>Client's files</Text>
      {loadFailed ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateText}>Couldn't load the client's files.</Text>
          <Pressable onPress={() => setReloadKey((k) => k + 1)} style={styles.retryBtn}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : sources == null ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={colors.yellowDark} />
        </View>
      ) : sources.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateText}>
            The client hasn't uploaded their files yet. Your delivery clock starts when they do —
            you'll see the deadline here.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {sources.map((f) => (
            <View key={f.id} style={styles.srcRow}>
              {f.isImage ? (
                <Image source={{ uri: f.url }} style={styles.srcThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.srcThumb, styles.srcVideo]}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Rect x="3" y="5" width="13" height="14" rx="3" stroke={colors.ink} strokeWidth={1.8} />
                    <Path d="M16 10l5-3v10l-5-3" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
                  </Svg>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.srcName} numberOfLines={1}>{f.name}</Text>
                {/* The meta line carries the file's own state: saving, saved,
                    or why it failed — three readings that cannot be confused
                    for one another. */}
                {downloadingIds.has(f.id) ? (
                  <Text style={styles.srcSaving}>Saving to your photos…</Text>
                ) : saveErrors[f.id] ? (
                  <Text style={styles.srcFailed}>{saveErrors[f.id]}</Text>
                ) : savedIds.has(f.id) ? (
                  <Text style={styles.srcSaved}>Saved to your photos</Text>
                ) : (
                  <Text style={styles.srcMeta}>{f.contentType ?? 'file'}</Text>
                )}
              </View>
              <Pressable
                onPress={() => saveSource(f)}
                disabled={downloadingIds.has(f.id)}
                style={styles.srcDl}
                accessibilityLabel={
                  downloadingIds.has(f.id)
                    ? `Saving ${f.name}`
                    : saveErrors[f.id]
                      ? `Retry saving ${f.name}`
                      : `Save ${f.name} to your photos`
                }
              >
                {downloadingIds.has(f.id) ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : savedIds.has(f.id) ? (
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 12.5l4.5 4.5L19 7" stroke="#159A57" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                ) : saveErrors[f.id] ? (
                  // A retry arrow, not the download arrow: the state it is
                  // returning from was a failure, and it should not read as
                  // a fresh untouched file.
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                    <Path d="M4 12a8 8 0 1 1 2.3 5.7" stroke={colors.error} strokeWidth={2} strokeLinecap="round" />
                    <Path d="M4 19v-5h5" stroke={colors.error} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                ) : (
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M5 19h14" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
                  </Svg>
                )}
              </Pressable>
            </View>
          ))}
          {!!saveNote && <Text style={styles.saveNote}>{saveNote}</Text>}
        </View>
      )}

      {/* Deliver / delivered / revision */}
      {delivered && !openRevision ? (
        <View style={styles.doneCard}>
          <View style={styles.doneIcon}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <Text style={styles.doneTitle}>Delivered</Text>
          <Text style={styles.doneSub}>
            The client has their edits and has been notified. Your payout lands in Earnings once
            the 7-day review window closes.
          </Text>
        </View>
      ) : (
        <>
          {openRevision && (
            <>
              <Text style={styles.sectionTitle}>Revision requested</Text>
              <View style={styles.revisionCard}>
                <Text style={styles.revisionText}>{openRevision.details}</Text>
              </View>
            </>
          )}
          <Text style={styles.sectionTitle}>
            {openRevision ? 'Deliver the updated files' : 'Deliver the finished edit'}
          </Text>
          <DeliverPanel
            batch={batch}
            alreadyUploaded={openRevision ? 0 : existingFinals}
            promisedCount={openRevision ? null : sources?.length ?? null}
            promisedLabel={sources?.length ? `${sources.length} source file${sources.length === 1 ? '' : 's'} in the order` : undefined}
            pickTitle={openRevision ? 'Add the updated files' : 'Add your finished edits'}
            pickSub="Full-resolution, unwatermarked — this is what the client receives"
            slideLabel={openRevision ? 'Slide to deliver revision' : 'Slide to submit finished edit'}
            notDeliveredNote={
              openRevision
                ? 'The client still has the previous version. Your updated files do not replace it until you slide below.'
                : "These files are uploaded, but the client cannot see or download them yet. This order stays open, and unpaid, until you slide below."
            }
            onDeliver={deliverFinal}
            error={deliverError}
          />
        </>
      )}

      {/* The client is a message away — no meeting point on a desk job. */}
      <Pressable onPress={() => router.push(`/(app)/messages/${job.id}`)} style={styles.msgBtn}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v8a2.5 2.5 0 01-2.5 2.5H9l-5 4v-4z" stroke={colors.ink} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
        <Text style={styles.msgLabel}>Message the client</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  orderCard: {
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
  orderLabel: { fontSize: 10, fontWeight: '800', color: colors.yellowDark, letterSpacing: 0.5 },
  orderName: { fontSize: 15.5, fontWeight: '800', color: colors.ink, marginTop: 6 },
  orderDesc: { fontSize: 12.5, color: colors.grey, marginTop: 3, lineHeight: 18 },
  styleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0EDE6',
  },
  styleDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  styleName: { fontSize: 13, fontWeight: '800', color: colors.ink },
  styleDesc: { fontSize: 12, color: colors.grey, marginTop: 2, lineHeight: 17 },
  deadlineCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#EFEDE7',
  },
  deadlineWarn: { backgroundColor: colors.yellowSoft, borderColor: colors.yellowSoftBorder },
  deadlineLate: { backgroundColor: '#FDEBEA', borderColor: '#F2C4C1' },
  deadlineTitle: { fontSize: 12, fontWeight: '800', color: colors.ink },
  deadlineWhen: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 4 },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: colors.ink, marginTop: 20, marginBottom: 10 },
  stateCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 10,
  },
  stateText: { fontSize: 12.5, color: colors.grey, lineHeight: 18.5, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.yellow },
  retryLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  srcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 9,
  },
  srcThumb: { width: 44, height: 44, borderRadius: 9, backgroundColor: '#EFEBE3' },
  srcVideo: { alignItems: 'center', justifyContent: 'center' },
  srcName: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  srcMeta: { fontSize: 10.5, color: colors.grey, marginTop: 1 },
  srcSaving: { fontSize: 10.5, color: colors.ink, fontWeight: '700', marginTop: 1 },
  srcSaved: { fontSize: 10.5, color: '#159A57', fontWeight: '700', marginTop: 1 },
  srcFailed: { fontSize: 10.5, color: colors.error, fontWeight: '600', marginTop: 1 },
  srcDl: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F6F1E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveNote: { fontSize: 12, color: colors.grey, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  doneCard: { alignItems: 'center', gap: 8, paddingVertical: 30, paddingHorizontal: 20 },
  doneIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  doneSub: { fontSize: 12.5, color: colors.grey, lineHeight: 19, textAlign: 'center' },
  revisionCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  revisionText: { fontSize: 13, color: colors.ink, lineHeight: 19 },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E1D8',
    backgroundColor: '#fff',
    marginTop: 22,
  },
  msgLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
});
