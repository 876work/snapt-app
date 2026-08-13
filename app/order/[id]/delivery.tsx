import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../../components/ui/SlideToConfirm';
import { creatorById, useBookings } from '../../../lib/store';
import { apiConfigured } from '../../../lib/api';
import { colors, insetBottom } from '../../../lib/theme';
import { offerSettings, photoFilename, saveToPhotos, shareFile } from '../../../lib/saveToPhotos';

// No mock fallback: a failed fetch used to show four bundled sample images
// as if they were the client's delivered files.

interface Deliverable {
  name: string;
  meta: string;
  /** Signed remote URL from the server ({ uri }). */
  thumb: { uri: string };
  tint: string;
  /** Media row id — needed to re-presign a link that has expired. */
  id?: string;
  contentType?: string | null;
  /** ISO of the delivered file, for a filename someone can find again. */
  createdAt?: string | null;
}

export default function Delivery() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const creator = creatorById(booking?.creatorId ?? null) ?? creatorById('jordan');
  const firstName = creator?.name.split(' ')[0] ?? 'your editor';

  // Real deliverables (signed URLs) in API mode — the endpoint only ever
  // returns deliverables to clients, never raw footage. Mock grid otherwise.
  // Retention-deleted files come back with deleted=true and no URL: they are
  // excluded from the grid and the screen shows a clear "no longer
  // available" state instead of broken images or dead downloads.
  const [real, setReal] = React.useState<Deliverable[] | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
  const [allDeleted, setAllDeleted] = React.useState(false);
  // Three states, creators.tsx-style: a failed fetch used to `return` early,
  // leaving the PAID-FOR delivery rendering as empty with no error and no
  // retry — the worst possible screen for failure to impersonate normal.
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  React.useEffect(() => {
    import('../../../lib/api').then(({ apiConfigured, fetchMediaListingApi }) => {
      if (!apiConfigured || !id) return;
      setLoadFailed(false);
      fetchMediaListingApi(id).then((listing) => {
        // null = the request failed (network, auth, server) — say so.
        if (!listing) {
          setLoadFailed(true);
          return;
        }
        setExpiresAt(listing.files_expire_at);
        // FINAL EDITS ONLY. The listing also returns Social proof galleries
        // (the client needed them to choose) — watermarked exports that must
        // never sit in the delivery grid or ride along on "Download all".
        const finals = listing.media.filter((m) => m.kind === 'deliverable');
        if (finals.length === 0) {
          setReal([]);
          return;
        }
        const live = finals.filter((m) => !m.deleted && m.download_url);
        if (live.length === 0) {
          setAllDeleted(true);
          setReal([]);
          return;
        }
        setReal(
          live.map((m, i) => ({
            name: m.download_url!.split('/').pop()?.split('?')[0]?.replace(/^\d+-/, '') ?? `file-${i + 1}`,
            meta: m.content_type ?? 'delivered file',
            thumb: { uri: m.download_url! },
            tint: '#F2C14E',
            id: m.id,
            contentType: m.content_type,
            createdAt: m.created_at ?? null,
          })),
        );
      });
    });
  }, [id, reloadKey]);
  const deliverables = real ?? [];

  // Save-to-device: download the signed file, then save to the photo
  // library (permission prompted on first use). Real files only — the mock
  // grid's bundled assets have nothing to save.
  const [savedNames, setSavedNames] = React.useState<Set<string>>(new Set());
  const [saveNote, setSaveNote] = React.useState<string | null>(null);

  const saveFile = async (d: Deliverable): Promise<boolean> => {
    const uri = d.thumb.uri;
    if (!uri) {
      setSaveNote('Demo files — downloads work on real deliveries.');
      return false;
    }
    const index = deliverables.findIndex((x) => x.name === d.name);
    const result = await saveToPhotos({
      url: uri,
      filename: photoFilename({
        subject: 'Delivery',
        date: d.createdAt,
        index: index >= 0 ? index + 1 : undefined,
        originalName: d.name,
        contentType: d.contentType,
      }),
      // Signed links last an hour; this listing was fetched on mount. Re-list
      // to re-presign rather than telling someone their delivery failed.
      refreshUrl: async () => {
        if (!id || !d.id) return null;
        const api = await import('../../../lib/api');
        const media = await api.fetchMediaApi(id);
        const fresh = media?.find((m) => m.id === d.id && !m.deleted);
        if (fresh?.download_url) {
          setReal((prev) =>
            (prev ?? []).map((x) =>
              x.id === d.id ? { ...x, thumb: { uri: fresh.download_url! } } : x,
            ),
          );
        }
        return fresh?.download_url ?? null;
      },
      context: 'client_delivery',
    });
    if (result.ok) {
      setSavedNames((prev) => new Set(prev).add(d.name));
      return true;
    }
    setSaveNote(result.message);
    offerSettings(result);
    return false;
  };

  /**
   * Send straight to WhatsApp and friends. Same filename and same re-presign
   * as saving, and it goes through the shared download step rather than a
   * second copy of it — that duplication is what made downloads broken in two
   * places for weeks.
   */
  const shareOne = async (d: Deliverable) => {
    const uri = d.thumb.uri;
    if (!uri) {
      setSaveNote('Demo files — sharing works on real deliveries.');
      return;
    }
    const index = deliverables.findIndex((x) => x.name === d.name);
    const result = await shareFile({
      url: uri,
      filename: photoFilename({
        subject: 'Delivery',
        date: d.createdAt,
        index: index >= 0 ? index + 1 : undefined,
        originalName: d.name,
        contentType: d.contentType,
      }),
      mimeType: d.contentType,
      refreshUrl: async () => {
        if (!id || !d.id) return null;
        const api = await import('../../../lib/api');
        const media = await api.fetchMediaApi(id);
        const fresh = media?.find((m) => m.id === d.id && !m.deleted);
        return fresh?.download_url ?? null;
      },
      context: 'client_delivery_share',
    });
    if (!result.ok) setSaveNote(result.message);
  };

  // Revision request (1 free round; extra rounds only if purchased at
  // booking). Server enforces entitlement; quality disputes require a
  // delivered revision first (Policy 08 §2).
  const [revText, setRevText] = React.useState('');
  const [revStatus, setRevStatus] = React.useState<string | null>(null);
  const [canBuyRound, setCanBuyRound] = React.useState(false);
  const buyRound = async () => {
    const api = await import('../../../lib/api');
    if (!api.apiConfigured || !id) return false;
    const result = await api.purchaseRevisionApi(id);
    if (result && 'purchased' in result) {
      setCanBuyRound(false);
      setRevStatus(`Extra round added ($${result.charged_usd.toFixed(2)}) — send your request again.`);
      return true;
    }
    setRevStatus(result && 'error' in result ? result.error : 'Purchase failed — try again.');
    return false; // slider unlocks so the user can retry
  };
  const requestRevision = async () => {
    setRevStatus(null);
    const api = await import('../../../lib/api');
    if (api.apiConfigured && id) {
      const result = await api.requestRevisionApi(id, revText.trim());
      if (result && 'error' in result) {
        setRevStatus(result.error);
        setCanBuyRound((result as { action?: string }).action === 'purchase_revision' || result.error.includes('used up'));
        return;
      }
      setCanBuyRound(false);
    }
    setRevText('');
    setRevStatus('Revision requested — your creator has been notified.');
  };

  const saveAll = async () => {
    setSaveNote(null);
    let ok = 0;
    for (const d of deliverables) if (await saveFile(d)) ok += 1;
    if (ok > 0) setSaveNote(`${ok} file${ok > 1 ? 's' : ''} saved to your library.`);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your content" />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {loadFailed && (
          <View style={styles.loadState}>
            <Text style={styles.loadStateTitle}>Couldn't load your delivery</Text>
            <Text style={styles.loadStateBody}>
              Your files are safe — this is a connection problem, not a missing delivery.
            </Text>
            <Pressable onPress={() => setReloadKey((k) => k + 1)} style={styles.loadRetry}>
              <Text style={styles.loadRetryLabel}>Try again</Text>
            </Pressable>
          </View>
        )}
        {!loadFailed && real == null && apiConfigured && (
          <View style={styles.loadState}>
            <ActivityIndicator color={colors.yellowDark} />
          </View>
        )}
        {!loadFailed && (real != null || !apiConfigured) && (<>
        {allDeleted && (
          <View style={styles.expiredCard}>
            <Text style={styles.expiredTitle}>These files are no longer available</Text>
            <Text style={styles.expiredSub}>
              {expiresAt
                ? `Delivered files were available until ${new Date(expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} and have now been permanently removed, as covered in our retention policy.`
                : 'Delivered files are stored for a limited period and have now been permanently removed, as covered in our retention policy.'}{' '}
              Files you downloaded to your device are unaffected.
            </Text>
          </View>
        )}
        {!allDeleted && deliverables.length === 0 && apiConfigured && (
          // Genuinely empty ≠ delivered. "It's ready! 0 edited files" was a
          // celebration card over nothing — say what's actually happening.
          <View style={styles.expiredCard}>
            <Text style={styles.expiredTitle}>Your delivery isn't here yet</Text>
            <Text style={styles.expiredSub}>
              Your creator is still working on the edits. You'll get a notification the moment
              they're delivered — no need to check back.
            </Text>
          </View>
        )}
        {!allDeleted && (deliverables.length > 0 || !apiConfigured) && (<>
        <View style={styles.readyCard}>
          <View style={styles.readyIcon}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.readyTitle}>It's ready!</Text>
            <Text style={styles.readySub}>
              {deliverables.length} edited files, delivered by {firstName}.
            </Text>
            {expiresAt && (
              <Text style={styles.expiryLine}>
                Available until{' '}
                {new Date(expiresAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}{' '}
                — download to keep forever.
              </Text>
            )}
          </View>
        </View>

        <View style={styles.grid}>
          {deliverables.map((d) => (
            <View key={d.name} style={styles.fileCard}>
              <View style={[styles.fileThumb, { backgroundColor: d.tint }]}>
                <Image source={d.thumb} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </View>
              <View style={styles.fileRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={styles.fileMeta}>{d.meta}</Text>
                </View>
                <Pressable onPress={() => shareOne(d)} style={styles.dlBtn}>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 16V4m0 0L8 8m4-4l4 4" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
                  </Svg>
                </Pressable>
                <Pressable onPress={() => saveFile(d)} style={styles.dlBtn}>
                  {savedNames.has(d.name) ? (
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12.5l4.5 4.5L19 7" stroke="#159A57" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  ) : (
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      <Path d="M5 19h14" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
                    </Svg>
                  )}
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.revCard}>
          <Text style={styles.revTitle}>Need changes? Use your included revision</Text>
          <TextInput
            value={revText}
            onChangeText={setRevText}
            placeholder="Describe specifically what should change"
            placeholderTextColor="#9A9A9A"
            multiline
            style={styles.revInput}
          />
          {revStatus ? <Text style={styles.revStatus}>{revStatus}</Text> : null}
          {canBuyRound ? (
            // Paid extra: charges the card on file, so it slides like every
            // other payment.
            <SlideToConfirm label="Slide to buy an extra revision round" onConfirm={buyRound} />
          ) : null}
          <Pressable
            onPress={requestRevision}
            style={[styles.revBtn, revText.trim().length < 10 && { opacity: 0.4 }]}
            disabled={revText.trim().length < 10}
          >
            <Text style={styles.revBtnLabel}>Request revision</Text>
          </Pressable>
        </View>
        </>)}
        </>)}
        <View style={{ height: 24 }} />
      </KeyboardScrollView>
      <View style={styles.footer}>
        {saveNote ? <Text style={styles.saveNote}>{saveNote}</Text> : null}
        {!allDeleted && (deliverables.length > 0 || !apiConfigured) && (
          <Pressable onPress={saveAll} style={styles.cta}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M5 19h14" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" />
            </Svg>
            <Text style={styles.ctaLabel}>Download all</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.push(`/order/${id}/rating`)} style={styles.rateBtn}>
          <Text style={styles.rateLabel}>Rate your experience</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  readyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFF4D6',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
  },
  readyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  readySub: { fontSize: 12.5, color: '#8A7530', marginTop: 2 },
  expiryLine: { fontSize: 11, fontWeight: '700', color: '#8A7530', marginTop: 6, lineHeight: 15 },
  loadState: { alignItems: 'center', justifyContent: 'center', paddingTop: 70, paddingHorizontal: 26, gap: 6 },
  loadStateTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  loadStateBody: { fontSize: 13, color: colors.grey, textAlign: 'center', lineHeight: 19 },
  loadRetry: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.yellow },
  loadRetryLabel: { fontSize: 14, color: colors.ink },
  expiredCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFEDE7',
    padding: 20,
    marginBottom: 20,
  },
  expiredTitle: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  expiredSub: { fontSize: 12.5, color: colors.grey, lineHeight: 18.5, marginTop: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fileCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  fileThumb: { height: 96 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12 },
  fileName: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  fileMeta: { fontSize: 10.5, color: colors.grey, marginTop: 1 },
  dlBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#F6F1E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 10,
  },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  rateBtn: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
  saveNote: { fontSize: 12.5, color: colors.grey, fontWeight: '600', textAlign: 'center' },
  revCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 18, gap: 10 },
  revTitle: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  revInput: { minHeight: 70, borderWidth: 1.5, borderColor: '#EFEBE3', borderRadius: 10, padding: 10, fontSize: 13, color: colors.ink, textAlignVertical: 'top' },
  revStatus: { fontSize: 12.5, color: colors.grey, fontWeight: '600' },
  revBtn: { height: 44, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  revBtnLabel: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
});
