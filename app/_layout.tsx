import React from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { initAuth } from '../lib/auth';
import { ApiErrorOverlay } from '../components/ui/ApiErrorOverlay';

export default function RootLayout() {
  // The design system is 100% Inter — every Text/TextInput renders through
  // lib/text.tsx, which maps fontWeight to these faces. Hold first paint
  // until they're ready (error falls through so a font CDN hiccup can never
  // brick the app — it just renders system fonts for that session).
  const [fontsLoaded, fontsError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  React.useEffect(() => {
    // Restores a persisted Supabase session (no-op in mock mode).
    initAuth();
    // Foreground notifications render as banners (no-op on builds without
    // the native module).
    import('../lib/push').then((p) => p.initPushHandling());
  }, []);

  if (!fontsLoaded && !fontsError) return null;

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FAFAFA' } }} />
        <ApiErrorOverlay />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
