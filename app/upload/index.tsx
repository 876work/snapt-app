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

export default function UploadFootage() {
  const router = useRouter();
  const { files, note, setNote, addPicked, removeFile } = useUpload();
  const [rejected, setRejected] = React.useState<RejectedFile[]>([]);

  // The picker is real in every mode — it reads files off the device and
  // does not need a server. Only the UPLOAD needs one, and that happens
  // after payment.
  const pick = async () => {
    setRejected([]);
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_FILES,
      quality: 1,
    });
    if (result.canceled) return;
    const bad = addPicked(
      result.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `upload-${Date.now()}-${i}.jpg`,
        mimeType: a.mimeType ?? undefined,
        sizeMb: Math.round(((a.fileSize ?? 0) / 1048576) * 10) / 10,
      })),
    );
    setRejected(bad);
  };

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
  const usage = totalMb >= 1000 ? `${(totalMb / 1000).toFixed(1)}GB` : `${totalMb}MB`;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Upload footage" />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Send us your raw photos or video and we'll make them shine. Up to {MAX_FILES} files per
          order.
        </Text>

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
              Add the photos or video you want edited. They upload once your order is paid, and only
              your assigned editor can see them.
            </Text>
          </View>
        ) : (
        <View style={styles.grid}>
          {files.map((f) => (
            <View key={f.id} style={[styles.thumb, { backgroundColor: f.tint }]}>
              {f.thumb && (
                <Image source={f.thumb} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              )}
              <Pressable onPress={() => removeFile(f.id)} style={styles.removeBtn} hitSlop={6}>
                <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
                </Svg>
              </Pressable>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeLabel}>{f.type}</Text>
              </View>
              <View style={styles.sizeBadge}>
                <Text style={styles.sizeBadgeLabel}>
                  {f.sizeMb >= 1000 ? `${(f.sizeMb / 1000).toFixed(1)}GB` : `${f.sizeMb}MB`}
                </Text>
              </View>
            </View>
          ))}
        </View>
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
        <Text style={styles.footerCount}>
          {files.length} {files.length === 1 ? 'file' : 'files'}{'\n'}ready
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
