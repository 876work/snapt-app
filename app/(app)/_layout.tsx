import React from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Text } from '../../lib/text';
import { colors, insetBottom } from '../../lib/theme';
import { navShrinkReset, useNavShrinkAnim } from '../../lib/navShrink';
import { BookingsIcon, HomeIcon, ProfileIcon, WalletIcon } from '../../components/ui/Icons';

const TABS: { name: string; label: string; Icon: (p: { color: string }) => React.JSX.Element }[] = [
  { name: 'home', label: 'Home', Icon: HomeIcon },
  { name: 'bookings', label: 'Bookings', Icon: BookingsIcon },
  { name: 'wallet', label: 'Wallet', Icon: WalletIcon },
  { name: 'profile', label: 'Profile', Icon: ProfileIcon },
];

interface TabBarProps {
  state: { index: number; routes: { name: string; key: string }[] };
  navigation: { navigate: (name: string) => void };
}

function PillTabBar({ state, navigation }: TabBarProps) {
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

// The floating pill bar shows ONLY on the four tab roots. Nested task
// screens (booking detail, cancel/reschedule, profile edit, …) carry their
// own headers and bottom CTAs — the absolutely-positioned bar was covering
// footer buttons/sliders (reported on the reschedule screen, 2026-08-04).
const TAB_ROOTS = ['/home', '/bookings', '/wallet', '/profile'];

export default function AppLayout() {
  const pathname = usePathname();
  return (
    <Tabs
      tabBar={(props) => (TAB_ROOTS.includes(pathname) ? <PillTabBar {...props} /> : null)}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.offWhite },
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="wallet" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="creators" options={{ href: null }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 18,
    right: 18,
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
