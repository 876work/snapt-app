import React from 'react';
import { AccessibilityInfo, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../../lib/text';
import { useRouter } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { colors, insetBottom, insetTop } from '../../lib/theme';

/**
 * Onboarding carousel — full-bleed artwork, edge to edge.
 *
 * The previous layout boxed the art in a 340pt card, which cover-cropped the
 * 640×~1040 portrait assets down to their middle band and left the space
 * between the copy and the footer as bare background — the dead zone.
 *
 * The assets are complete designed frames: they carry a baked-in wordmark at
 * the top, a baked "Skip" label at the top-right of s1/s2, and their own
 * copy on a white panel at the bottom. Full-bleed brings the wordmark back
 * (a deliberate brand moment, sitting below the status bar) while the scrim
 * swallows the baked bottom panel so the app's own copy — the strings below,
 * unchanged — renders over it without doubling. The baked "Skip" pixels are
 * handled by the focal crop (tall screens) and by the real Skip control
 * sitting over that corner (short screens); see coverGeometry.
 */
const SLIDES = [
  {
    key: 's1',
    image: require('../../assets/design/onboarding/s1.webp'),
    title: 'Book a creator near you',
    sub: 'Vetted photographers and videographers across Saint Lucia, matched to your moment.',
    bakedSkip: true,
  },
  {
    key: 's2',
    image: require('../../assets/design/onboarding/s2.webp'),
    title: 'Or send us your footage',
    sub: 'Already shot the moment? Upload it and a Snapt editor delivers a polished edit.',
    bakedSkip: true,
  },
  {
    key: 's3',
    image: require('../../assets/design/onboarding/s3.webp'),
    title: 'Safe, simple, yours',
    sub: 'Verified creators, safety check-ins, and your photos delivered right in the app.',
    bakedSkip: false,
  },
];

/** Reserved band at the bottom of every slide for dots + button + insets. */
const FOOTER_RESERVE = 128;

/**
 * Cover-fit with a controllable focal point, in place of resizeMode="cover"
 * (which can only center). All in source pixels first so the numbers can be
 * read against the asset files directly:
 *
 *  - Faces occupy roughly x 85..450 in all three frames; the left crop is
 *    capped so no aspect ratio from SE (0.56) to tall Android (0.44) can
 *    reach them.
 *  - s1/s2 carry a baked "Skip" at x≈555.. that must not fight the real one,
 *    so those slides prefer to spend their crop budget on the right edge.
 *    On screens too wide to crop that far (SE class), the remnant surfaces
 *    exactly under the real Skip control, which covers it.
 */
function coverGeometry(W: number, H: number, src: { width: number; height: number }, bakedSkip: boolean) {
  const scale = Math.max(W / src.width, H / src.height);
  const dispW = src.width * scale;
  const dispH = src.height * scale;
  const overSrcX = (dispW - W) / scale;
  const leftCutSrc = bakedSkip
    ? Math.min(Math.max(overSrcX - 86, 0), 85)
    : Math.min(overSrcX * 0.5, 100);
  const leftCut = leftCutSrc * scale;
  const rightCut = dispW - W - leftCut;
  // Wider-than-art screens (rare) crop vertically instead; keep the top
  // quarter-biased so the wordmark and faces stay in frame.
  const topCut = (dispH - H) * 0.25;
  return { dispW, dispH, leftCut, rightCut, topCut };
}

/** OS reduce-motion, live. When on, every animation below is skipped. */
function useReduceMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

function Slide({
  item,
  index,
  scrollX,
  reduceMotion,
  W,
  H,
}: {
  item: (typeof SLIDES)[number];
  index: number;
  scrollX: SharedValue<number>;
  reduceMotion: boolean;
  W: number;
  H: number;
}) {
  const src = Image.resolveAssetSource(item.image);
  const g = coverGeometry(W, H, src, item.bakedSkip);

  // Parallax amplitude is bounded by the crop actually available on each
  // side — sliding the image further than the crop reveals background, so
  // on near-square-aspect screens (SE) the effect quietly shrinks to zero
  // rather than tearing the edge. Cheap on the UI thread either way.
  const ampL = Math.min(0.55 * g.leftCut, 0.15 * W);
  const ampR = Math.min(0.55 * g.rightCut, 0.15 * W);

  const imageStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { transform: [{ translateX: -g.leftCut }] };
    const dx = scrollX.value - index * W;
    return {
      transform: [
        {
          translateX: interpolate(dx, [-W, 0, W], [-g.leftCut - ampR, -g.leftCut, -g.leftCut + ampL], Extrapolation.CLAMP),
        },
      ],
    };
  }, [reduceMotion, g.leftCut, ampL, ampR, W]);

  // Text runs slightly ahead of the swipe and settles with a small rise;
  // the body's opacity window is narrower than the headline's, so the
  // headline lands first and the body follows — the stagger.
  const titleStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1 };
    const dx = scrollX.value - index * W;
    return {
      opacity: interpolate(dx, [-0.75 * W, 0, 0.75 * W], [0, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: -0.14 * dx },
        { translateY: interpolate(dx, [-W, 0, W], [14, 0, 14], Extrapolation.CLAMP) },
      ],
    };
  }, [reduceMotion, W]);
  const subStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1 };
    const dx = scrollX.value - index * W;
    return {
      opacity: interpolate(dx, [-0.5 * W, 0, 0.5 * W], [0, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: -0.14 * dx },
        { translateY: interpolate(dx, [-W, 0, W], [22, 0, 22], Extrapolation.CLAMP) },
      ],
    };
  }, [reduceMotion, W]);

  return (
    <View style={{ width: W, height: H, overflow: 'hidden' }}>
      <Animated.Image
        source={item.image}
        style={[{ position: 'absolute', top: -g.topCut, left: 0, width: g.dispW, height: g.dispH }, imageStyle]}
      />
      <View style={[styles.copy, { bottom: insetBottom + FOOTER_RESERVE }]} pointerEvents="none">
        <Animated.View style={titleStyle}>
          <Text style={styles.title}>{item.title}</Text>
        </Animated.View>
        <Animated.View style={subStyle}>
          <Text style={styles.sub}>{item.sub}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

/** One pagination dot: width and colour animate with the scroll position. */
function Dot({
  index,
  scrollX,
  page,
  reduceMotion,
  W,
}: {
  index: number;
  scrollX: SharedValue<number>;
  page: number;
  reduceMotion: boolean;
  W: number;
}) {
  const style = useAnimatedStyle(() => {
    if (reduceMotion) return {};
    const around = [(index - 1) * W, index * W, (index + 1) * W];
    return {
      width: interpolate(scrollX.value, around, [7, 22, 7], Extrapolation.CLAMP),
      backgroundColor: interpolateColor(scrollX.value, around, ['#E9E2D2', colors.yellow, '#E9E2D2']),
    };
  }, [reduceMotion, W]);
  // Reduce-motion: a hard, state-driven swap — no interpolation at all.
  const staticStyle = reduceMotion
    ? { width: page === index ? 22 : 7, backgroundColor: page === index ? colors.yellow : '#E9E2D2' }
    : undefined;
  return <Animated.View style={[styles.dot, style, staticStyle]} />;
}

export default function Intro() {
  const router = useRouter();
  const { width: W, height: H } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [page, setPage] = React.useState(0);
  const listRef = React.useRef<Animated.FlatList<(typeof SLIDES)[number]>>(null);
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });
  const last = page === SLIDES.length - 1;

  return (
    <View style={styles.root}>
      <Animated.FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
        getItemLayout={(_, index) => ({ length: W, offset: W * index, index })}
        renderItem={({ item, index }) => (
          <Slide item={item} index={index} scrollX={scrollX} reduceMotion={reduceMotion} W={W} H={H} />
        )}
        keyExtractor={(i) => i.key}
      />

      {/* Scrim: fixed over the lower half so white copy reads on the yellow
          artwork (and the assets' baked bottom panel disappears into it).
          The top of the image stays undimmed. */}
      <View style={styles.scrim} pointerEvents="none">
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#140F05" stopOpacity="0" />
              <Stop offset="0.42" stopColor="#140F05" stopOpacity="0.34" />
              <Stop offset="0.72" stopColor="#140F05" stopOpacity="0.82" />
              <Stop offset="1" stopColor="#140F05" stopOpacity="0.95" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrim)" />
        </Svg>
      </View>

      {/* Skip — screens 1 and 2 only, gone on 3. Sits exactly over the corner
          where s1/s2 bake a "Skip" into the artwork, so on screens where the
          focal crop can't remove those pixels, this control covers them. */}
      {page < SLIDES.length - 1 && (
        <Pressable
          onPress={() => router.push('/(auth)/signup')}
          hitSlop={12}
          style={styles.skip}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
        >
          <Text style={styles.skipLabel}>Skip</Text>
        </Pressable>
      )}

      {/* Footer floats over the artwork — no panel behind it. */}
      <View style={[styles.footer, { paddingBottom: insetBottom + 18 }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <Dot key={s.key} index={i} scrollX={scrollX} page={page} reduceMotion={reduceMotion} W={W} />
          ))}
        </View>
        <Button
          title={last ? 'Create my account' : 'Next'}
          arrow
          onPress={() => {
            if (last) {
              router.push('/(auth)/signup');
            } else {
              listRef.current?.scrollToIndex({ index: page + 1, animated: !reduceMotion });
              if (reduceMotion) setPage(page + 1);
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5A93B' },
  copy: { position: 'absolute', left: 24, right: 24 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, color: '#fff', marginBottom: 10 },
  sub: { fontSize: 14.5, lineHeight: 21, color: 'rgba(255,255,255,0.88)' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' },
  skip: {
    position: 'absolute',
    top: insetTop + 6,
    right: 14,
    backgroundColor: 'rgba(245,241,232,0.92)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipLabel: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  footer: { position: 'absolute', left: 24, right: 24, bottom: 0, gap: 18 },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E9E2D2' },
});
