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
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { Text } from '../lib/text';

/**
 * Root error boundary (expo-router renders this for any uncaught render
 * error below the root layout). A recoverable branded screen instead of a
 * silent crash to the home screen — "Try again" re-renders the failed
 * route.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={ebStyles.root}>
      <Text style={ebStyles.title}>Something went wrong</Text>
      <Text style={ebStyles.sub}>
        The app hit an unexpected error. Your data is safe — try again, and if it keeps happening,
        let us know via Help &amp; support.
      </Text>
      <Text style={ebStyles.detail} numberOfLines={3}>
        {error.message}
      </Text>
      <Pressable onPress={retry} style={ebStyles.cta}>
        <Text style={ebStyles.ctaLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const ebStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: '#1A1A1A' },
  sub: { fontSize: 13.5, color: '#767676', lineHeight: 20, textAlign: 'center', marginTop: 10 },
  detail: { fontSize: 11, color: '#B4B1AA', textAlign: 'center', marginTop: 14 },
  cta: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#FFB800',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 26,
  },
  ctaLabel: { fontSize: 15, fontWeight: '800', color: '#1A1A1A' },
});

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

  React.useEffect(() => {
    // Lets Stripe close the 3D Secure browser when the bank sends the user
    // back to snapt://safepay. Without this the challenge succeeds and the
    // browser just sits on "Authentication Complete".
    let dispose: (() => void) | undefined;
    import('../lib/payments').then((p) => {
      dispose = p.installStripeReturnHandler();
    });
    return () => dispose?.();
  }, []);

  if (!fontsLoaded && !fontsError) return null;

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        {/* ONE keyboard strategy for the whole app: on iOS the router outlet
            shrinks above the keyboard, so every screen's pinned footer (and
            its Continue/submit button) stays reachable while typing. Android
            resizes the window itself (adjustResize) — adding padding there
            too would double-shift. Per-screen scroll views add
            keyboardShouldPersistTaps so buttons work on first tap and a tap
            on empty space dismisses. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Publishable key only — it is safe on-device by design; the
              secret key never leaves the server. */}
          <StripeProvider
            publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
            urlScheme="snapt"
          >
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FAFAFA' } }} />
          </StripeProvider>
        </KeyboardAvoidingView>
        <ApiErrorOverlay />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
