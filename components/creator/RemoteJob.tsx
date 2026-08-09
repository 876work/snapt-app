import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { Text } from '../../lib/text';
import { DeliverPanel, useUploadBatch } from './DeliverUploader';
import type { JobOffer } from '../../lib/store/creator';
import { REMOTE_PACKAGES } from '../../lib/store/upload';
import { colors } from '../../lib/theme';

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

export function RemoteJob({ job }: { job: JobOffer }) {
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

  const saveSource = async (f: SourceFile) => {
    setSaveNote(null);
    try {
      const FS = (await import('expo-file-system')) as Record<string, any>;
      let localUri: string;
      if (FS.File && FS.Paths) {
        const file = await FS.File.downloadFileAsync(f.url, new FS.Directory(FS.Paths.cache));
        localUri = file.uri;
      } else {
        const result = await FS.downloadAsync(f.url, `${FS.cacheDirectory}${f.name}`);
        localUri = result.uri;
      }
      const MediaLibrary = await import('expo-media-library');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setSaveNote('Allow photo access to save the source files.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      setSavedIds((prev) => new Set(prev).add(f.id));
    } catch {
      setSaveNote(`Couldn't save ${f.name} — try again.`);
    }
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
      return true;
    }
    const r = await api.deliverApi(job.id);
    if (!r || 'error' in (r as object)) {
      setDeliverError((r as { error?: string })?.error ?? 'Delivery failed — try again.');
      return false;
    }
    setDelivered(true);
    batch.reset();
    return true;
  };

  const pkg = job.remoteTier
    ? REMOTE_PACKAGES[job.mediaKind ?? 'photo']?.find((p) => p.tier === job.remoteTier)
    : undefined;

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
                <Text style={styles.srcMeta}>{f.contentType ?? 'file'}</Text>
              </View>
              <Pressable onPress={() => saveSource(f)} style={styles.srcDl}>
                {savedIds.has(f.id) ? (
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 12.5l4.5 4.5L19 7" stroke="#159A57" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
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
