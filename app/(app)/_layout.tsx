import React from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../lib/theme';
import { BookingsIcon, HomeIcon, ProfileIcon, WalletIcon } from '../../components/ui/Icons';

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.bar,
        tabBarActiveTintColor: colors.yellow,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
        sceneStyle: { backgroundColor: colors.offWhite },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          tabBarIcon: ({ color }) => <Tab icon={<HomeIcon color={String(color)} />} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          tabBarIcon: ({ color }) => <Tab icon={<BookingsIcon color={String(color)} />} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          tabBarIcon: ({ color }) => <Tab icon={<WalletIcon color={String(color)} />} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ color }) => <Tab icon={<ProfileIcon color={String(color)} />} />,
        }}
      />
    </Tabs>
  );
}

function Tab({ icon }: { icon: React.ReactNode }) {
  return <View style={styles.tab}>{icon}</View>;
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 28,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ink,
    borderTopWidth: 0,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  tab: { alignItems: 'center', justifyContent: 'center', paddingTop: 6 },
});
