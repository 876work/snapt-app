import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import type { SlotConflict } from '../../lib/api';
import { colors, insetBottom } from '../../lib/theme';

/**
 * The way forward when the chosen time stops being available — either
 * pre-validated on Order Summary mount or reported by the server at booking
 * time. A dead-end error at the exact moment someone tried to pay is the
 * worst possible place to strand them.
 */
export function SlotRecoverySheet({
  conflict,
  creatorName,
  chosenTime,
  onPickTime,
  onRematch,
  onEditDetails,
  onClose,
}: {
  conflict: SlotConflict | null;
  /** Known display name for the chosen creator, if one was chosen. */
  creatorName: string | null;
  chosenTime: string | null;
  onPickTime: (time: string) => void;
  onRematch: () => void;
  onEditDetails: () => void;
  onClose: () => void;
}) {
  if (!conflict) return null;
  const who = creatorName ?? 'your creator';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.iconWrap}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="9" stroke={colors.yellowDark} strokeWidth={1.9} />
            <Path d="M12 7.5V12l3 2" stroke={colors.yellowDark} strokeWidth={1.9} strokeLinecap="round" />
          </Svg>
        </View>
        <Text style={styles.title}>That time was just taken</Text>
        <Text style={styles.sub}>
          {conflict.code === 'creator_taken'
            ? `${who} is no longer free at ${chosenTime ?? 'that time'} — someone got there first. Here's what still works:`
            : `${chosenTime ?? 'That slot'} was booked while you were checking out. Here's what still works:`}
        </Text>

        {conflict.alternative_times.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>
              {creatorName ? `Other times with ${who} today` : 'Other times today'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {conflict.alternative_times.map((t) => (
                <Pressable key={t} onPress={() => onPickTime(t)} style={styles.chip}>
                  <Text style={styles.chipLabel}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {conflict.code === 'creator_taken' && conflict.rematch_available && (
          <Pressable onPress={onRematch} style={styles.option}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>Keep {chosenTime ?? 'my time'} — match me with another creator</Text>
              <Text style={styles.optionSub}>
                Another vetted creator is free at this exact time. Same pricing, same standard.
              </Text>
            </View>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        )}

        <Pressable onPress={onEditDetails} style={styles.option}>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>Change date or details</Text>
            <Text style={styles.optionSub}>Go back and pick a different day or setup.</Text>
          </View>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Path d="M9 6l6 6-6 6" stroke={colors.yellowDark} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.45)' },
  sheet: {
    backgroundColor: colors.offWhite,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: Math.max(insetBottom + 14, 30),
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDD9D0', marginBottom: 16 },
  iconWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sub: { fontSize: 13, color: colors.grey, lineHeight: 19.5, marginTop: 6, marginBottom: 16 },
  sectionLabel: { fontSize: 12.5, fontWeight: '800', color: colors.ink, marginBottom: 9 },
  chipRow: { gap: 8, paddingBottom: 16 },
  chip: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.yellowSoftBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 15,
    marginBottom: 10,
  },
  optionTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  optionSub: { fontSize: 12, color: colors.grey, lineHeight: 17, marginTop: 3 },
});
