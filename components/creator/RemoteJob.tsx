import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { Text } from '../../lib/text';
import { DeliverPanel, useUploadBatch } from './DeliverUploader';
import { RevisionFlag } from './RevisionFlag';
import type { JobOffer } from '../../lib/store/creator';
import { EDIT_STYLES, REMOTE_PACKAGES } from '../../lib/store/upload';
import { colors } from '../../lib/theme';
import { photoFilename, saveToPhotos } from '../../lib/saveToPhotos';
import { useSaveStates } from '../../lib/useSaveStates';
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
  /**
   * EVERY open request, not the oldest one.
   *
   * This was a single row found with `.find(r => r.status === 'open')` over a
   * list the server returns oldest-first, so when a client had two open
   * requests the creator saw the FIRST and the newer text existed nowhere on
   * screen — while a notification had already announced it. Orders aec459a2
   * and fb32aef6 were both in that state on 2026-08-21/22. Acting on stale
   * instructions with newer ones invisible is a dispute risk, so all of them
   * render. The server now refuses a second while one is open, but rows that
   * already exist still have to be readable.
   */
  const [openRevisions, setOpenRevisions] = React.useState<
    { id: string; details: string; createdAt: string; isFree: boolean; flagged: boolean }[]
  >([]);
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
      setOpenRevisions(
        (revs ?? [])
          .filter((r) => r.status === 'open')
          .map((r) => ({
            id: r.id,
            details: r.details,
            createdAt: r.created_at,
            isFree: r.is_free,
            flagged: !!r.flagged,
          })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id, reloadKey, delivered]);

  // On a revision round the previous delivery is already with the client, so
  // only THIS batch is unsent; on a first delivery the finals registered by an
  // earlier, abandoned attempt count too — they are exactly what the client
  // is missing.
  const undelivered = openRevisions.length > 0
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
   * is refused rather than queued), complete (green check), and failed (the
   * file's own row goes red and carries the reason). Failure is deliberately
   * NOT the same shape as either other state, which is the whole point of
   * the previous fix on this path.
   *
   * The machinery itself lives in lib/useSaveStates and is shared with the
   * client's delivery screen — one implementation, two screens, rather than
   * the second copy that made downloads broken in two places before.
   */
  const saves = useSaveStates('creator_source');

  const saveSource = async (f: SourceFile) => {
    setSaveNote(null);
    // The in-flight guard, the three states and the Settings prompt all live
    // in the hook now — a second tap while the transfer runs is refused
    // there, not here.
    await saves.save({ key: f.id, run: () => saveSourceFile(f) });
  };

  /** The save itself, with no state handling — useSaveStates owns that. */
  const saveSourceFile = async (f: SourceFile) => {
    const index = (sources ?? []).findIndex((s) => s.id === f.id);
    return saveToPhotos({
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
  };

  const deliverFinal = async () => {
    setDeliverError(null);
    const api = await import('../../lib/api');
    if (openRevisions.length > 0) {
      // Closes the OLDEST open round — unchanged behaviour. A legacy order
      // with two open rounds therefore needs two deliveries; the server now
      // prevents any new order reaching that state.
      const r = await api.deliverRevisionApi(job.id, openRevisions[0].id);
      if (r && 'error' in (r as object)) {
        setDeliverError((r as { error?: string }).error ?? 'Delivery failed — try again.');
        return false;
      }
      setOpenRevisions([]);
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
                {saves.stateOf(f.id) === 'saving' ? (
                  <Text style={styles.srcSaving}>Saving to your photos…</Text>
                ) : saves.errors[f.id] ? (
                  <Text style={styles.srcFailed}>{saves.errors[f.id]}</Text>
                ) : saves.stateOf(f.id) === 'saved' ? (
                  <Text style={styles.srcSaved}>Saved to your photos</Text>
                ) : (
                  <Text style={styles.srcMeta}>{f.contentType ?? 'file'}</Text>
                )}
              </View>
              <Pressable
                onPress={() => saveSource(f)}
                disabled={saves.stateOf(f.id) === 'saving'}
                style={styles.srcDl}
                accessibilityLabel={
                  saves.stateOf(f.id) === 'saving'
                    ? `Saving ${f.name}`
                    : saves.errors[f.id]
                      ? `Retry saving ${f.name}`
                      : `Save ${f.name} to your photos`
                }
              >
                {saves.stateOf(f.id) === 'saving' ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : saves.stateOf(f.id) === 'saved' ? (
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 12.5l4.5 4.5L19 7" stroke="#159A57" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                ) : saves.errors[f.id] ? (
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
      {delivered && openRevisions.length === 0 ? (
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
          {openRevisions.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>
                {openRevisions.length === 1
                  ? 'Revision requested'
                  : `${openRevisions.length} revision requests`}
              </Text>
              {openRevisions.map((r, i) => (
                <View key={r.id} style={[styles.revisionCard, i > 0 && { marginTop: 8 }]}>
                  {/* Included vs paid, in plain words. is_free has been on
                      every row from the start and shown to nobody — which of
                      a creator's rounds were PURCHASED is exactly the kind of
                      fact a dispute turns on. */}
                  <Text style={styles.revisionWhen}>
                    {openRevisions.length > 1
                      ? `${i + 1} of ${openRevisions.length} · `
                      : ''}
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' · '}
                    {r.isFree ? 'Included revision' : 'Paid revision'}
                  </Text>
                  <Text style={styles.revisionText}>{r.details}</Text>
                  <RevisionFlag
                    bookingId={job.id}
                    revisionId={r.id}
                    flagged={r.flagged}
                    onFlagged={(revId) =>
                      setOpenRevisions((prev) =>
                        prev.map((x) => (x.id === revId ? { ...x, flagged: true } : x)),
                      )
                    }
                  />
                </View>
              ))}
            </>
          )}
          <Text style={styles.sectionTitle}>
            {openRevisions.length > 0 ? 'Deliver the updated files' : 'Deliver the finished edit'}
          </Text>
          <DeliverPanel
            batch={batch}
            alreadyUploaded={openRevisions.length > 0 ? 0 : existingFinals}
            promisedCount={openRevisions.length > 0 ? null : sources?.length ?? null}
            promisedLabel={sources?.length ? `${sources.length} source file${sources.length === 1 ? '' : 's'} in the order` : undefined}
            pickTitle={openRevisions.length > 0 ? 'Add the updated files' : 'Add your finished edits'}
            pickSub="Full-resolution, unwatermarked — this is what the client receives"
            slideLabel={openRevisions.length > 0 ? 'Slide to deliver revision' : 'Slide to submit finished edit'}
            notDeliveredNote={
              openRevisions.length > 0
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
  revisionWhen: { fontSize: 10.5, color: colors.grey, fontWeight: '700', marginBottom: 3 },
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
