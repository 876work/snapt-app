import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { RadioDot } from '../../components/ui/RadioDot';
import { DURATIONS, MediaKind, packagePrice, SOCIAL_TIERS, SocialTierDef } from '../../lib/mock/data';
import { useAuth, useBookings } from '../../lib/store';
import { formatMoney, OCCASION_DEFAULT_DURATION_HOURS } from '../../lib/constants/business';
import { colors, spacing, insetBottom } from '../../lib/theme';

const PKG_DESC: Record<MediaKind, string> = {
  photo: 'Edited, color-graded photos delivered in the app.',
  video: 'A polished highlight video cut by a Snapt editor.',
  both: 'Photos plus a highlight video — our full coverage package.',
};

/** One line describing what a bundle includes — the product IS this line. */
function bundleContents(t: SocialTierDef): string {
  const parts = [`${t.photos} edited photos`];
  if (t.videos > 0) parts.push(`${t.videos} × 30-sec edited video${t.videos > 1 ? 's' : ''}`);
  return parts.join(' + ');
}

export default function DurationAndPackage() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const { draft, setDraft } = useBookings();
  const isSocial = draft.occasion === 'Social';

  // Live bundle catalog: admin price edits apply with no app update. The
  // hardcoded mirror only covers offline/mock mode.
  const [tiers, setTiers] = React.useState<SocialTierDef[]>(SOCIAL_TIERS);
  // Duration prices: live pricing_table with the static mirror as fallback —
  // the same live-first pattern the Social catalog above already uses. An
  // admin price edit shows here without an app update.
  const [liveTable, setLiveTable] = React.useState<Record<string, Record<string, number>> | null>(null);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchPricingConfig }) => {
      if (!apiConfigured) return;
      fetchPricingConfig().then((c) => {
        if (c) setLiveTable(c.pricingTable);
      });
    });
  }, []);
  const priceFor = (kind: MediaKind, hours: number): number | undefined =>
    liveTable?.[kind]?.[String(hours)] ?? packagePrice(kind, hours);
  React.useEffect(() => {
    if (!isSocial) return;
    import('../../lib/api').then(({ apiConfigured, fetchSocialCatalog }) => {
      if (!apiConfigured) return;
      fetchSocialCatalog().then((c) => {
        if (c) setTiers(c.tiers);
      });
    });
  }, [isSocial]);

  const pickTier = (t: SocialTierDef) =>
    setDraft({
      social: t,
      durationHours: t.duration_hours,
      mediaKind: t.videos > 0 ? 'both' : 'photo',
    });

  // Occasion-based smart default — pre-selected, fully overridable (§7).
  const recommendedHours = draft.occasion
    ? OCCASION_DEFAULT_DURATION_HOURS[draft.occasion]
    : undefined;

  React.useEffect(() => {
    if (draft.durationHours == null && recommendedHours != null) {
      setDraft({ durationHours: recommendedHours });
    }
  }, []);

  const selected = DURATIONS.find((d) => d.hours === draft.durationHours);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Duration & package" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {isSocial ? (
          <>
            <Text style={styles.lead}>
              Social sessions are priced by what you take home, not by the clock. Pick a bundle —
              you'll choose your favourite shots for editing after the shoot.
            </Text>
            <View style={{ gap: 10 }}>
              {tiers.map((t) => {
                const active = draft.social?.id === t.id;
                return (
                  <Pressable key={t.id} onPress={() => pickTier(t)} style={[styles.row, active && styles.rowActive]}>
                    <RadioDot selected={active} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowTitleWrap}>
                        <Text style={styles.rowTitle}>{t.label}</Text>
                        <View style={styles.popBadge}>
                          <Text style={styles.popBadgeLabel}>
                            {t.duration_hours} {t.duration_hours === 1 ? 'HOUR' : 'HOURS'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.rowDeliv}>{bundleContents(t)}</Text>
                    </View>
                    <Text style={styles.rowPrice}>{formatMoney(t.price_usd, currency)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.pkgDesc}>
              After the session your creator shares a proof gallery with more shots than your
              bundle includes — you pick the ones you want fully edited. Want extras beyond your
              bundle? Add them per photo or video at selection time.
            </Text>
          </>
        ) : (
        <>
        <Text style={styles.lead}>Pick how long you need your creator.</Text>
        <Text style={styles.sectionLabel}>What do you need?</Text>
        <SegmentedControl
          options={[
            { value: 'photo', label: '📷 Photos' },
            { value: 'video', label: '🎥 Video' },
            { value: 'both', label: '🎁 Both' },
          ]}
          value={draft.mediaKind}
          onChange={(mediaKind) => setDraft({ mediaKind })}
        />
        <Text style={styles.pkgDesc}>{PKG_DESC[draft.mediaKind]}</Text>

        <Text style={[styles.sectionLabel, { marginTop: 24, marginBottom: 4 }]}>
          Session length
        </Text>
        <Text style={styles.hint}>
          Same-day sessions are available with a couple of hours' notice — today's remaining
          times appear only if a creator can still get there.
        </Text>
        <View style={{ gap: 10 }}>
          {DURATIONS.map((d) => {
            const active = draft.durationHours === d.hours;
            // Only Events has a confirmed default (2h) — no badge for other
            // occasions until their defaults are specified.
            const rec = recommendedHours === d.hours;
            const price = priceFor(draft.mediaKind, d.hours);
            return (
              <Pressable
                key={d.hours}
                onPress={() => setDraft({ durationHours: d.hours })}
                style={[styles.row, active && styles.rowActive]}
              >
                <RadioDot selected={active} />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleWrap}>
                    <Text style={styles.rowTitle}>{d.label}</Text>
                    {rec && draft.occasion && (
                      <View style={styles.recBadge}>
                        <Text style={styles.recBadgeLabel}>
                          Recommended for {draft.occasion}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowDeliv}>{d.deliverables}</Text>
                </View>
                <Text style={styles.rowPrice}>
                  {price != null ? formatMoney(price, currency) : '—'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
      <View style={styles.footer}>
        <View>
          <Text style={styles.footMetaLabel}>session</Text>
          <Text style={styles.footMetaValue}>
            {isSocial
              ? draft.social
                ? formatMoney(draft.social.price_usd, currency)
                : '—'
              : selected != null
                ? formatMoney(priceFor(draft.mediaKind, selected.hours) ?? 0, currency)
                : '—'}
          </Text>
        </View>
        <Button
          title="Continue"
          arrow
          disabled={isSocial ? !draft.social : !selected}
          onPress={() => router.push('/booking/location')}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  lead: { fontSize: 13.5, color: colors.grey, lineHeight: 19.5, marginBottom: 16 },
  sectionLabel: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginBottom: 12 },
  pkgDesc: { fontSize: 12.5, color: colors.grey, lineHeight: 18, marginTop: 10, paddingHorizontal: 2 },
  hint: { fontSize: 12, color: colors.grey, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 15,
  },
  rowActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  popBadge: { backgroundColor: colors.yellowTint, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  popBadgeLabel: { fontSize: 9, fontWeight: '800', color: colors.goldText, letterSpacing: 0.4 },
  recBadge: { backgroundColor: colors.yellow, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  recBadgeLabel: { fontSize: 9, fontWeight: '800', color: colors.ink, letterSpacing: 0.3 },
  rowDeliv: { fontSize: 12, color: colors.grey, marginTop: 4 },
  rowPrice: { fontSize: 15, fontWeight: '800', color: colors.ink },
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
  footMetaLabel: { fontSize: 11, color: colors.grey },
  footMetaValue: { fontSize: 17, fontWeight: '800', color: colors.ink },
});
