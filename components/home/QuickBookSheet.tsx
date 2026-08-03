import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { OCCASIONS, Occasion, AREAS, Area } from '../../lib/mock/data';
import { creatorById, useBookings } from '../../lib/store';
import { CreatorAvatar } from '../ui/CreatorAvatar';
import { colors, insetBottom } from '../../lib/theme';
import { OccasionIcon } from '../ui/Icons';
import { Divider, InfoBanner } from '../ui/Misc';

export function QuickBookSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { bookings, setDraft, resetDraft } = useBookings();
  const [mode, setMode] = React.useState<'in-person' | 'remote'>('in-person');
  const [occasion, setOccasion] = React.useState<Occasion | null>(null);
  const [area, setArea] = React.useState<Area | null>(null);
  const [areaOpen, setAreaOpen] = React.useState(false);
  const [date, setDate] = React.useState<string | null>(null);

  // Next 14 days for the quick-start date strip (matches the booking
  // advance window). Availability is still enforced on Date & Time — this
  // just pre-fills the draft.
  const days = React.useMemo(() => {
    return Array.from({ length: 14 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const label =
        i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      return { iso, label };
    });
  }, []);

  const lastCompleted = bookings.find((b) => b.status === 'completed');
  const lastCreator = lastCompleted ? creatorById(lastCompleted.creatorId) : undefined;

  const startBooking = () => {
    resetDraft('in-person');
    setDraft({ occasion, area, type: 'in-person', date });
    onClose();
    router.push('/booking/occasion');
  };

  const startUpload = () => {
    onClose();
    router.push('/upload');
  };

  const bookAgain = () => {
    if (!lastCompleted) return;
    resetDraft('in-person');
    // Pre-fill from most recent booking; skips to Date & Time
    // (still availability-checked) — handoff §7.
    setDraft({
      occasion: lastCompleted.occasion,
      area: lastCompleted.area,
      durationHours: lastCompleted.durationHours,
      creatorId: lastCompleted.creatorId,
      mediaKind: lastCompleted.mediaKind,
    });
    onClose();
    router.push('/booking/occasion?bookAgain=1');
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Start a booking</Text>
              <Text style={styles.sub}>Tell us the moment and we'll match a creator.</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M6 6l12 12M18 6L6 18" stroke={colors.yellow} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
            </Pressable>
          </View>

          {lastCompleted && lastCreator && (
            <>
              <Pressable onPress={bookAgain} style={styles.againCard}>
                <View style={[styles.againAvatar, { backgroundColor: lastCreator.tint, overflow: 'hidden' }]}>
                  <CreatorAvatar name={lastCreator.name} photo={lastCreator.photo} textSize={16} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.againOverline}>Book again</Text>
                  <Text style={styles.againTitle}>
                    {lastCompleted.occasion} with {lastCreator.name}
                  </Text>
                  <Text style={styles.againMeta} numberOfLines={1}>
                    {lastCompleted.durationHours}hr · {lastCompleted.area}
                  </Text>
                </View>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 6l6 6-6 6" stroke="#C9A44C" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
              <View style={{ marginTop: 16 }}>
                <Divider label="or start fresh" />
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>In person or remote?</Text>
          <View style={styles.segTrack}>
            {(
              [
                ['in-person', 'In person'],
                ['remote', 'Remote edit'],
              ] as const
            ).map(([v, label]) => (
              <Pressable
                key={v}
                onPress={() => setMode(v)}
                style={[styles.seg, mode === v && styles.segActive]}
              >
                <Text style={[styles.segLabel, mode === v && styles.segLabelActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'in-person' ? (
            <>
              <Text style={styles.sectionLabel}>What's the moment?</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -20 }}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 4 }}
              >
                {OCCASIONS.map((o) => {
                  const active = occasion === o;
                  return (
                    <Pressable
                      key={o}
                      onPress={() => setOccasion(o)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <OccasionIcon occasion={o} />
                      <Text style={styles.chipLabel}>{o}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable onPress={() => setAreaOpen(!areaOpen)} style={styles.locRow}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"
                    stroke={colors.grey}
                    strokeWidth={1.8}
                    strokeLinejoin="round"
                  />
                  <Circle cx="12" cy="10" r="2.3" stroke={colors.grey} strokeWidth={1.8} />
                </Svg>
                <Text style={[styles.locLabel, area && { color: colors.ink, fontWeight: '700' }]}>
                  {area ?? 'Choose your area'}
                </Text>
                <Svg width={11} height={7} viewBox="0 0 12 8" fill="none">
                  <Path
                    d="M1 1.5L6 6.5L11 1.5"
                    stroke={colors.greyLight}
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
              {areaOpen && (
                <View style={styles.areaList}>
                  {AREAS.map((a) => (
                    <Pressable
                      key={a}
                      onPress={() => {
                        setArea(a);
                        setAreaOpen(false);
                      }}
                      style={styles.areaItem}
                    >
                      <Text
                        style={[
                          styles.areaItemLabel,
                          a === area && { color: colors.yellowDark, fontWeight: '800' },
                        ]}
                      >
                        {a}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.sectionLabel}>When?</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -20 }}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 4 }}
              >
                {days.map((d) => {
                  const active = date === d.iso;
                  return (
                    <Pressable
                      key={d.iso}
                      onPress={() => setDate(active ? null : d.iso)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={styles.chipLabel}>{d.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable onPress={startBooking} style={styles.cta}>
                <Text style={styles.ctaLabel}>Check availability</Text>
                <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M5 12h13m0 0l-5-5m5 5l-5 5"
                    stroke={colors.ink}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            </>
          ) : (
            <>
              <View style={{ marginTop: 16 }}>
                <InfoBanner text="No shoot needed — send us footage you already have and a Snapt editor takes it from there." />
              </View>
              <Pressable onPress={startUpload} style={styles.cta}>
                <Text style={styles.ctaLabel}>Upload footage</Text>
                <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M5 12h13m0 0l-5-5m5 5l-5 5"
                    stroke={colors.ink}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(20,18,14,0.42)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: Math.max(insetBottom + 12, 34),
    maxHeight: '86%',
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E6E2D9',
    alignSelf: 'center',
    marginBottom: 16,
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sub: { fontSize: 12.5, color: colors.greyWarm, marginTop: 4 },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1.5,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 16,
    padding: 13,
    marginTop: 18,
  },
  againAvatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againAvatarLetter: { fontSize: 18, fontWeight: '800', color: '#fff' },
  againOverline: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.yellowDark,
  },
  againTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 3 },
  againMeta: { fontSize: 11.5, color: colors.goldText, fontWeight: '600', marginTop: 2 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.ink,
    marginTop: 18,
    marginBottom: 9,
  },
  segTrack: { flexDirection: 'row', gap: 5, backgroundColor: colors.segBg, borderRadius: 13, padding: 4 },
  seg: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segActive: {
    // CD design: the active segment is the black pill, not white.
    backgroundColor: colors.ink,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segLabel: { fontSize: 13, fontWeight: '600', color: colors.grey },
  segLabelActive: { color: '#fff', fontWeight: '800' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  chipLabel: { fontSize: 11, fontWeight: '700', color: colors.ink },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 14,
    marginTop: 14,
  },
  locLabel: { flex: 1, fontSize: 12.5, fontWeight: '600', color: '#9A9A9A' },
  areaList: {
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 14,
    marginTop: 6,
    overflow: 'hidden',
  },
  areaItem: { paddingVertical: 12, paddingHorizontal: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  areaItemLabel: { fontSize: 13, fontWeight: '600', color: colors.ink },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
    shadowColor: colors.yellow,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
