import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { InfoBanner } from '../../components/ui/Misc';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { apiConfigured, fetchMyPortfolio, submitPortfolioItemApi, PortfolioItem } from '../../lib/api';
import { colors, spacing } from '../../lib/theme';

// Creator portfolio submission (Policy 04 §6.2): the first 3 photos are
// pre-approved by a moderator before they appear publicly; submissions
// after that publish automatically. Status comes from the server.

const STATUS_BADGE: Record<PortfolioItem['status'], { label: string; bg: string; fg: string }> = {
  pending: { label: 'In review', bg: '#FFF4D6', fg: '#8A7530' },
  approved: { label: 'Published', bg: '#E4F4E8', fg: '#2E7D43' },
  auto: { label: 'Published', bg: '#E4F4E8', fg: '#2E7D43' },
  rejected: { label: 'Not approved', bg: '#FDECEA', fg: '#B4442E' },
};

export default function CreatorPortfolio() {
  const [items, setItems] = React.useState<PortfolioItem[]>([]);
  const [caption, setCaption] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!apiConfigured) return;
    fetchMyPortfolio().then((list) => {
      if (list) setItems(list);
    });
  }, []);
  React.useEffect(load, [load]);

  const addPhoto = async () => {
    if (busy) return;
    setStatus(null);
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const file = {
      uri: asset.uri,
      name: asset.fileName ?? `portfolio-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
    };

    if (!apiConfigured) {
      // Mock mode: mirror the server's pre-approval rule locally.
      const publishedCount = items.filter((i) => i.status === 'approved' || i.status === 'auto').length;
      setItems((prev) => [
        {
          id: `mock-${Date.now()}`,
          caption: caption.trim() || null,
          status: publishedCount >= 3 ? 'auto' : 'pending',
          created_at: new Date().toISOString(),
          url: asset.uri,
        },
        ...prev,
      ]);
      setCaption('');
      return;
    }

    setBusy(true);
    const submitted = await submitPortfolioItemApi(file, caption);
    setBusy(false);
    if (!submitted || 'error' in submitted) {
      setStatus(submitted && 'error' in submitted ? submitted.error : 'Upload failed — try again.');
      return;
    }
    setCaption('');
    setStatus(
      submitted.published
        ? 'Added to your portfolio.'
        : 'Submitted — our team reviews your first few photos before they go live.',
    );
    load();
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Portfolio" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <InfoBanner text="Your portfolio is what clients see when choosing a creator. Your first 3 photos are reviewed by our team before they appear — after that, new photos publish automatically." />

        <View style={{ marginTop: 18, gap: 12 }}>
          <TextField
            label="Caption (optional)"
            value={caption}
            onChangeText={setCaption}
            placeholder="e.g. Golden hour portrait, Rodney Bay"
          />
          {status ? <Text style={styles.status}>{status}</Text> : null}
          <Button title={busy ? 'Uploading…' : 'Add photo'} disabled={busy} onPress={addPhoto} />
        </View>

        <Text style={styles.sectionLabel}>Your photos</Text>
        {items.length === 0 ? (
          <Text style={styles.empty}>
            Nothing here yet — add your best work to start winning bookings.
          </Text>
        ) : (
          <View style={styles.grid}>
            {items.map((item) => {
              const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.pending;
              return (
                <View key={item.id} style={styles.card}>
                  {item.url ? (
                    <Image source={{ uri: item.url }} style={styles.photo} resizeMode="cover" />
                  ) : (
                    <View style={[styles.photo, styles.photoMissing]} />
                  )}
                  <View style={styles.cardMeta}>
                    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.badgeLabel, { color: badge.fg }]}>{badge.label}</Text>
                    </View>
                    {item.caption ? (
                      <Text style={styles.caption} numberOfLines={2}>
                        {item.caption}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  status: { fontSize: 13, fontWeight: '600', color: colors.grey },
  sectionLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.yellowDark,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 24,
    marginBottom: 10,
    marginHorizontal: 2,
  },
  empty: { fontSize: 13, color: colors.greyWarm, lineHeight: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  photo: { width: '100%', aspectRatio: 1 },
  photoMissing: { backgroundColor: '#EFEBE3' },
  cardMeta: { padding: 10, gap: 6 },
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  caption: { fontSize: 11.5, color: colors.grey, lineHeight: 15 },
});
