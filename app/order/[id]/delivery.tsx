import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { creatorById, useBookings } from '../../../lib/store';
import { colors } from '../../../lib/theme';

const DELIVERABLES = [
  { name: 'Sunset-reel-final.mp4', meta: '0:45 · 4K', thumb: require('../../../assets/design/bookings/p2.webp'), tint: '#6FD3E0' },
  { name: 'Golden-hour-01.jpg', meta: '24MP · retouched', thumb: require('../../../assets/design/bookings/p1.webp'), tint: '#F2C14E' },
  { name: 'Golden-hour-02.jpg', meta: '24MP · retouched', thumb: require('../../../assets/design/bookings/p3.webp'), tint: '#F2A0B5' },
  { name: 'Family-candids.jpg', meta: '24MP · retouched', thumb: require('../../../assets/design/bookings/p4.webp'), tint: '#8ED7A6' },
];

export default function Delivery() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings } = useBookings();
  const booking = bookings.find((b) => b.id === id);
  const creator = creatorById(booking?.creatorId ?? null) ?? creatorById('jordan');
  const firstName = creator?.name.split(' ')[0] ?? 'your editor';

  // Real deliverables (signed URLs) in API mode — the endpoint only ever
  // returns deliverables to clients, never raw footage. Mock grid otherwise.
  const [real, setReal] = React.useState<typeof DELIVERABLES | null>(null);
  React.useEffect(() => {
    import('../../../lib/api').then(({ apiConfigured, fetchMediaApi }) => {
      if (!apiConfigured || !id) return;
      fetchMediaApi(id).then((media) => {
        if (!media || media.length === 0) return;
        setReal(
          media.map((m, i) => ({
            name: m.download_url.split('/').pop()?.split('?')[0]?.replace(/^\d+-/, '') ?? `file-${i + 1}`,
            meta: m.content_type ?? 'delivered file',
            thumb: { uri: m.download_url } as unknown as number,
            tint: '#F2C14E',
          })),
        );
      });
    });
  }, [id]);
  const deliverables = real ?? DELIVERABLES;

  // Save-to-device: download the signed file, then save to the photo
  // library (permission prompted on first use). Real files only — the mock
  // grid's bundled assets have nothing to save.
  const [savedNames, setSavedNames] = React.useState<Set<string>>(new Set());
  const [saveNote, setSaveNote] = React.useState<string | null>(null);

  const saveFile = async (d: (typeof DELIVERABLES)[number]): Promise<boolean> => {
    const uri = (d.thumb as unknown as { uri?: string }).uri;
    if (!uri) {
      setSaveNote('Demo files — downloads work on real deliveries.');
      return false;
    }
    try {
      const FS = (await import('expo-file-system')) as Record<string, any>;
      let localUri: string;
      if (FS.File && FS.Paths) {
        // SDK 54+ File API
        const file = await FS.File.downloadFileAsync(uri, new FS.Directory(FS.Paths.cache));
        localUri = file.uri;
      } else {
        const result = await FS.downloadAsync(uri, `${FS.cacheDirectory}${d.name}`);
        localUri = result.uri;
      }
      const MediaLibrary = await import('expo-media-library');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setSaveNote('Allow photo access to save your files.');
        return false;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      setSavedNames((prev) => new Set(prev).add(d.name));
      return true;
    } catch {
      setSaveNote(`Couldn't save ${d.name} — try again.`);
      return false;
    }
  };

  // Revision request (1 free round; extra rounds only if purchased at
  // booking). Server enforces entitlement; quality disputes require a
  // delivered revision first (Policy 08 §2).
  const [revText, setRevText] = React.useState('');
  const [revStatus, setRevStatus] = React.useState<string | null>(null);
  const requestRevision = async () => {
    setRevStatus(null);
    const api = await import('../../../lib/api');
    if (api.apiConfigured && id) {
      const result = await api.requestRevisionApi(id, revText.trim());
      if (result && 'error' in result) {
        setRevStatus(result.error);
        return;
      }
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
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.readyCard}>
          <View style={styles.readyIcon}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <View>
            <Text style={styles.readyTitle}>It's ready!</Text>
            <Text style={styles.readySub}>
              {deliverables.length} edited files, delivered by {firstName}.
            </Text>
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
          <Pressable
            onPress={requestRevision}
            style={[styles.revBtn, revText.trim().length < 10 && { opacity: 0.4 }]}
            disabled={revText.trim().length < 10}
          >
            <Text style={styles.revBtnLabel}>Request revision</Text>
          </Pressable>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        {saveNote ? <Text style={styles.saveNote}>{saveNote}</Text> : null}
        <Pressable onPress={saveAll} style={styles.cta}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M5 19h14" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" />
          </Svg>
          <Text style={styles.ctaLabel}>Download all</Text>
        </Pressable>
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
    paddingBottom: 30,
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
