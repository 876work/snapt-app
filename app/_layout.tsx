import React from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { initAuth } from '../lib/auth';

export default function RootLayout() {
  React.useEffect(() => {
    // Restores a persisted Supabase session (no-op in mock mode).
    initAuth();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FAFAFA' } }} />
    </GestureHandlerRootView>
  );
}
