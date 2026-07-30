import React from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import Svg, { Circle, Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CREATORS } from '../../lib/mock/data';
import { CreatorAvatar } from '../../components/ui/CreatorAvatar';
import { colors } from '../../lib/theme';

export default function AllCreators() {
  return (
    <View style={styles.root}>
      <ScreenHeader title="Creators near you" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {CREATORS.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={[styles.photoWrap, { backgroundColor: c.tint }]}>
                <CreatorAvatar name={c.name} photo={c.photo} />
                <View style={styles.ratingPill}>
                  <Svg width={11} height={11} viewBox="0 0 24 24" fill={colors.yellow}>
                    <Path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />
                  </Svg>
                  <Text style={styles.ratingText}>
                    {c.rating != null ? c.rating.toFixed(1) : 'New'}{c.rating != null && <Text style={styles.ratingReviews}> ({c.sessions})</Text>}
                  </Text>
                </View>
              </View>
              <View style={styles.cardBody}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.name}>{c.name}</Text>
                  {c.verified && (
                    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15.7l.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.2L12 3z" fill={colors.yellow} />
                      <Path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
                <View style={styles.tagRow}>
                  {c.specialties.slice(0, 2).map((t) => (
                    <View key={t} style={styles.tag}>
                      <Text style={styles.tagLabel}>{t}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.locRow}>
                  <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" stroke="#8A8377" strokeWidth={1.8} strokeLinejoin="round" />
                    <Circle cx="12" cy="10" r="2.3" stroke="#8A8377" strokeWidth={1.8} />
                  </Svg>
                  <Text style={styles.loc}>{c.loc}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 20, paddingTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  photoWrap: { height: 148 },
  ratingPill: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: { fontSize: 11, fontWeight: '800', color: colors.ink },
  ratingReviews: { color: colors.greyWarm, fontWeight: '600' },
  cardBody: { paddingHorizontal: 11, paddingTop: 10, paddingBottom: 11 },
  name: { fontSize: 12, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 7 },
  tag: { backgroundColor: colors.segBgAlt, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagLabel: { fontSize: 9.5, fontWeight: '600', color: '#5C574E' },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 9 },
  loc: { fontSize: 10, color: colors.greyWarm, fontWeight: '600' },
});
