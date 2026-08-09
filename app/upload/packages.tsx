import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { RadioDot } from '../../components/ui/RadioDot';
import { EDIT_STYLES, REMOTE_PACKAGES, useUpload } from '../../lib/store/upload';
import { useAuth } from '../../lib/store';
import { formatMoney } from '../../lib/constants/business';
import { colors, insetBottom } from '../../lib/theme';
import type { MediaKind } from '../../lib/mock/data';

const THUMBS = [
  require('../../assets/design/bookings/p1.webp'),
  require('../../assets/design/bookings/p3.webp'),
  require('../../assets/design/bookings/p5.webp'),
  require('../../assets/design/bookings/p2.webp'),
];

export default function ChooseYourEdit() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { mediaKind, setMediaKind, styleId, setStyleId, tier, setTier, files } = useUpload();
  const selStyle = EDIT_STYLES.find((s) => s.id === styleId) ?? EDIT_STYLES[0];
  // Live remote prices, mirror as fallback — names and descriptions are
  // static copy; only the number can drift, so only the number goes live.
  const [liveRemote, setLiveRemote] = React.useState<Record<string, Record<string, number>> | null>(null);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchPricingConfig }) => {
      if (!apiConfigured) return;
      fetchPricingConfig().then((c) => {
        if (c) setLiveRemote(c.remoteTable);
      });
    });
  }, []);
  const packages = REMOTE_PACKAGES[mediaKind].map((p) => ({
    ...p,
    priceUsd: liveRemote?.[mediaKind]?.[p.tier] ?? p.priceUsd,
  }));


  return (
    <View style={styles.root}>
      <ScreenHeader title="Choose your edit" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>What kind of edit do you need?</Text>
        {/* Shared control, same emoji labels as Duration & package. The
            local copy here had drifted: no emoji, and a WHITE active pill
            against the shared control's black one. */}
        <SegmentedControl
          options={[
            { value: 'photo' as MediaKind, label: '📷 Photos' },
            { value: 'video' as MediaKind, label: '🎥 Video' },
            { value: 'both' as MediaKind, label: '🎁 Both' },
          ]}
          value={mediaKind}
          onChange={setMediaKind}
        />

        <Text style={styles.sectionTitle}>Pick a package</Text>
        <View style={{ gap: 10, marginBottom: 4 }}>
          {packages.map((p) => {
            const active = tier === p.tier;
            const suggested = mediaKind === 'photo' && active && files.length > 0;
            return (
              <Pressable
                key={p.tier}
                onPress={() => setTier(p.tier)}
                style={[styles.tierRow, active && styles.tierRowActive]}
              >
                <RadioDot selected={active} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.tierName}>{p.name}</Text>
                    {suggested && (
                      <View style={styles.tierSuggest}>
                        <Text style={styles.tierSuggestLabel}>MATCHES YOUR {files.length} FILES</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.tierDesc}>{p.desc}</Text>
                </View>
                <Text style={styles.tierPrice}>{formatMoney(p.priceUsd, currency)}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Pick a style</Text>
        <View style={styles.grid}>
          {EDIT_STYLES.map((s, i) => {
            const sel = s.id === styleId;
            return (
              <Pressable
                key={s.id}
                onPress={() => setStyleId(s.id)}
                style={[styles.styleCard, sel && styles.styleCardSel]}
              >
                <View style={[styles.styleThumb, { backgroundColor: s.tint }]}>
                  <Image source={THUMBS[i % THUMBS.length]} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  {sel && (
                    <View style={styles.selCheck}>
                      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                        <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    </View>
                  )}
                </View>
                <View style={{ paddingHorizontal: 12, paddingTop: 9, paddingBottom: 11 }}>
                  <Text style={styles.styleName}>{s.name}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.styleInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.8} />
              <Path d="M12 11v5" stroke={colors.yellowDark} strokeWidth={1.8} strokeLinecap="round" />
              <Circle cx="12" cy="8" r="1.1" fill={colors.yellowDark} />
            </Svg>
            <Text style={styles.styleInfoName}>{selStyle.name}</Text>
          </View>
          <Text style={styles.styleInfoDesc}>{selStyle.desc}</Text>
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <View>
          <Text style={styles.fromLabel}>package</Text>
          <Text style={styles.fromValue}>
            {formatMoney(packages.find((p) => p.tier === tier)?.priceUsd ?? packages[0].priceUsd, currency)}
          </Text>
        </View>
        <Pressable onPress={() => router.push('/upload/pricing')} style={styles.cta}>
          <Text style={styles.ctaLabel}>Review order</Text>
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
  lead: { fontSize: 14, color: colors.grey, lineHeight: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 24, marginBottom: 12 },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 15,
  },
  tierRowActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  tierName: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  tierDesc: { fontSize: 12, color: colors.grey, marginTop: 3 },
  tierPrice: { fontSize: 15, fontWeight: '800', color: colors.ink },
  tierSuggest: { backgroundColor: colors.yellowTint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tierSuggestLabel: { fontSize: 8, fontWeight: '800', color: colors.goldText, letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  styleCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  styleCardSel: { borderColor: colors.yellow },
  styleThumb: { height: 80, backgroundColor: '#EFEBE3' },
  selCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  styleName: { fontSize: 13, fontWeight: '700', lineHeight: 16, color: colors.ink },
  styleInfo: {
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 14,
    padding: 14,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  styleInfoName: { fontSize: 14, fontWeight: '800', color: colors.ink },
  styleInfoDesc: { fontSize: 12.5, color: '#6B6250', lineHeight: 18 },
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
  fromLabel: { fontSize: 11, color: colors.grey },
  fromValue: { fontSize: 17, fontWeight: '800', color: colors.ink },
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
