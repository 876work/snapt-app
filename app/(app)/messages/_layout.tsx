import { Stack } from 'expo-router';

// Without this file there IS no route named "messages": expo-router
// registers messages/index and messages/[bookingId] as separate top-level
// routes, <Tabs.Screen name="messages"> matches nothing, and the pill bar's
// routes.find() returns undefined — the tab silently vanishes. Every other
// directory tab (bookings, profile) had this layout; messages never did,
// which is why the tab was missing on every bundle since it was built.
export default function MessagesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FAFAFA' } }} />
  );
}
