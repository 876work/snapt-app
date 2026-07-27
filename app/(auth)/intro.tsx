import React from 'react';
import { Dimensions, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Button } from '../../components/ui/Button';
import { colors } from '../../lib/theme';

const { width } = Dimensions.get('window');

// Placeholder illustrations — real onboarding images (s1–s3 from the design
// project) exceed the asset-sync size cap; swap in when exported manually.
const SLIDES = [
  {
    key: 's1',
    tint: '#FFF4D6',
    title: 'Book a creator near you',
    sub: 'Vetted photographers and videographers across Saint Lucia, matched to your moment.',
    icon: (
      <Svg width={80} height={80} viewBox="0 0 24 24" fill="none">
        <Rect x="2.6" y="6.8" width="18.8" height="13.4" rx="3.2" fill="#F2C14E" />
        <Path d="M8.6 6.8l1.3-2.2h4.2l1.3 2.2H8.6z" fill="#B96A20" />
        <Circle cx="12" cy="13.4" r="4.4" fill="#FFF3D0" />
        <Circle cx="12" cy="13.4" r="2.5" fill="#E8863D" />
        <Circle cx="18" cy="10" r="1" fill="#fff" />
      </Svg>
    ),
  },
  {
    key: 's2',
    tint: '#EAFBFD',
    title: 'Or send us your footage',
    sub: 'Already shot the moment? Upload it and a Snapt editor delivers a polished edit.',
    icon: (
      <Svg width={80} height={80} viewBox="0 0 24 24" fill="none">
        <Path
          d="M6.5 18a4 4 0 01-.5-7.97A5.5 5.5 0 0117 9.5a3.5 3.5 0 011 6.9"
          stroke="#3FA9BC"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M12 12v6M9.5 14.2L12 11.7l2.5 2.5"
          stroke="#3FA9BC"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    ),
  },
  {
    key: 's3',
    tint: '#F3FBF1',
    title: 'Safe, simple, yours',
    sub: 'Verified creators, safety check-ins, and your photos delivered right in the app.',
    icon: (
      <Svg width={80} height={80} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 2l8 3v6c0 5-3.4 9.2-8 11-4.6-1.8-8-6-8-11V5l8-3z"
          fill="#8ED7A6"
        />
        <Path
          d="M8.5 12l2.5 2.5 4.5-4.5"
          stroke="#fff"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    ),
  },
];

export default function Intro() {
  const router = useRouter();
  const [page, setPage] = React.useState(0);
  const listRef = React.useRef<FlatList>(null);
  const last = page === SLIDES.length - 1;

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={{ width, paddingHorizontal: 24 }}>
            <View style={[styles.art, { backgroundColor: item.tint }]}>{item.icon}</View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.sub}>{item.sub}</Text>
          </View>
        )}
        keyExtractor={(i) => i.key}
      />
      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <Button
          title={last ? 'Create my account' : 'Next'}
          arrow
          onPress={() => {
            if (last) {
              router.push('/(auth)/signup');
            } else {
              listRef.current?.scrollToIndex({ index: page + 1 });
              setPage(page + 1);
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite, paddingTop: 90 },
  art: {
    height: 340,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 34,
  },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, color: colors.ink, marginBottom: 10 },
  sub: { fontSize: 14.5, lineHeight: 21, color: colors.grey },
  footer: { paddingHorizontal: 24, paddingBottom: 48, gap: 22 },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E0DCD2' },
  dotActive: { backgroundColor: colors.yellow, width: 22 },
});
