import React from 'react';
import { Redirect, Tabs, usePathname } from 'expo-router';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { navShrinkReset, useNavShrinkAnim } from '../../lib/navShrink';
import { Text } from '../../lib/text';
import { useAuth } from '../../lib/store';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, insetBottom } from '../../lib/theme';

function JobsIcon({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="7.5" width="18" height="12" rx="2.5" stroke={color} strokeWidth={2} />
      <Path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5" stroke={color} strokeWidth={2} />
    </Svg>
  );
}
function SchedIcon({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={color} strokeWidth={2} />
      <Path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
function EarnIcon({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Path d="M4 18V9M9.5 18V5M15 18v-6M20.5 18v-9" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
function ProfIcon({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8.5" r="3.6" stroke={color} strokeWidth={2} />
      <Path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const TABS = [
  { name: 'index', label: 'Jobs', Icon: JobsIcon },
  { name: 'schedule', label: 'Schedule', Icon: SchedIcon },
  { name: 'earnings', label: 'Earnings', Icon: EarnIcon },
  { name: 'profile', label: 'Profile', Icon: ProfIcon },
];

interface TabBarProps {
  state: { index: number; routes: { name: string; key: string }[] };
  navigation: { navigate: (name: string) => void };
}

function CreatorTabBar({ state, navigation }: TabBarProps) {
  const { opacity, scale } = useNavShrinkAnim();
  return (
    <Animated.View style={[styles.bar, { opacity, transform: [{ scale }] }]}>
      {TABS.map((tab) => {
        const route = state.routes.find((r) => r.name === tab.name);
        if (!route) return null;
        const active = state.routes[state.index].name === tab.name;
        return (
          <Pressable
            key={tab.name}
            onPress={() => {
              navShrinkReset();
              navigation.navigate(tab.name);
            }}
            style={[styles.item, active && styles.itemActive]}
          >
            <tab.Icon color={active ? colors.ink : 'rgba(255,255,255,0.75)'} />
            {active && <Text style={styles.label}>{tab.label}</Text>}
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

export default function CreatorLayout() {
  const creatorStatus = useAuth((s) => s.creatorStatus);
  const pathname = usePathname();

  // Status gate for the whole creator shell — every route branches off the
  // single server-side status. Non-approved users only ever see the screen
  // for their state; approved users get bounced off the status screens.
  const HOME_FOR: Record<string, string> = {
    not_applied: '/creator/apply',
    in_progress: '/creator/apply',
    pending_review: '/creator/pending',
    rejected: '/creator/rejected',
    suspended: '/creator/suspended',
    approved: '/creator',
  };
  const statusHome = HOME_FOR[creatorStatus] ?? '/creator/apply';
  const openRoutes = ['/creator/apply', '/creator/pending', '/creator/rejected', '/creator/suspended'];
  if (creatorStatus !== 'approved') {
    if (pathname !== statusHome) return <Redirect href={statusHome} />;
  } else if (openRoutes.includes(pathname)) {
    return <Redirect href="/creator" />;
  }

  return (
    <Tabs
      // No tab bar until approved — apply/pending render as plain screens.
      tabBar={(props) => (creatorStatus === 'approved' ? <CreatorTabBar {...props} /> : null)}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.offWhite } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="schedule" />
      <Tabs.Screen name="earnings" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="cash-out" options={{ href: null }} />
      <Tabs.Screen name="ratings" options={{ href: null }} />
      <Tabs.Screen name="specialties" options={{ href: null }} />
      <Tabs.Screen name="portfolio" options={{ href: null }} />
      <Tabs.Screen name="apply" options={{ href: null }} />
      <Tabs.Screen name="pending" options={{ href: null }} />
      <Tabs.Screen name="rejected" options={{ href: null }} />
      <Tabs.Screen name="suspended" options={{ href: null }} />
      <Tabs.Screen name="job/[id]" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: Math.max(insetBottom + 8, 26),
    backgroundColor: colors.ink,
    borderRadius: 28,
    padding: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: colors.ink,
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  item: {
    height: 42,
    minWidth: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
  },
  itemActive: { backgroundColor: colors.yellow, paddingHorizontal: 16 },
  label: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
});
