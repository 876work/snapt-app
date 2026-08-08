import React from 'react';
import { Redirect, Tabs, usePathname } from 'expo-router';
import { Animated, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../lib/text';
import { colors, insetBottom } from '../../lib/theme';
import { navShrinkReset, useNavShrinkAnim } from '../../lib/navShrink';
import { BookingsIcon, HomeIcon, MessagesIcon, ProfileIcon } from '../../components/ui/Icons';
import { apiBase, authHeaders } from '../../lib/api';
import { useAuth } from '../../lib/store';

const TABS: { name: string; label: string; Icon: (p: { color: string }) => React.JSX.Element }[] = [
  { name: 'home', label: 'Home', Icon: HomeIcon },
  { name: 'bookings', label: 'Bookings', Icon: BookingsIcon },
  { name: 'messages', label: 'Messages', Icon: MessagesIcon },
  { name: 'profile', label: 'Profile', Icon: ProfileIcon },
];

/** Polled from the root layout (always mounted) so the badge is live on
 * every tab, not just while Messages itself is on screen. */
function useUnreadMessages(): number {
  const [unread, setUnread] = React.useState(0);
  React.useEffect(() => {
    if (!apiBase) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/v1/messages/unread`, { headers: await authHeaders() });
        if (!stop && res.ok) setUnread(((await res.json()) as { unread: number }).unread);
      } catch {
        /* next poll corrects it */
      }
    };
    poll();
    const id = setInterval(poll, 25_000);
    // Timers are suspended while the app is backgrounded, so coming back to
    // the app could show a stale count for up to a full interval — exactly
    // when a push has just told someone they have a new message. Re-poll the
    // moment we're active again.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') poll();
    });
    return () => {
      stop = true;
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return unread;
}

interface TabBarProps {
  state: { index: number; routes: { name: string; key: string }[] };
  navigation: { navigate: (name: string) => void };
}

function PillTabBar({ state, navigation }: TabBarProps) {
  const { opacity, scale } = useNavShrinkAnim();
  const unread = useUnreadMessages();
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
            <View>
              <tab.Icon color={active ? colors.ink : 'rgba(255,255,255,0.75)'} />
              {tab.name === 'messages' && unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              )}
            </View>
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
const TAB_ROOTS = ['/home', '/bookings', '/messages', '/profile'];

export default function AppLayout() {
  const pathname = usePathname();
  const signedIn = useAuth((s) => s.signedIn);
  const hydrated = useAuth((s) => s.hydrated);

  // Safety net for links that reach a signed-in-only screen without a
  // session — an OS-level snapt:// link, or a notification tap racing
  // session restore. Without it these screens render their chrome over
  // failing 401 fetches, which reads as a broken app rather than a locked
  // one.
  //
  // Deliberately does NOT park a pending link: only a notification tap is
  // real intent. Saving the path here would mean signing out from Profile
  // and then being dropped back on Profile at the next sign-in.
  if (hydrated && !signedIn) return <Redirect href="/(auth)/login" />;

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
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="creators" options={{ href: null }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
      {/* No longer a tab — Payment methods still lives here, reached from
          Profile → Account. */}
      <Tabs.Screen name="wallet" options={{ href: null }} />
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
  badge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  badgeLabel: { fontSize: 9, fontWeight: '800', color: '#fff' },
});
