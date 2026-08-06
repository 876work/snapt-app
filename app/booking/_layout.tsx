import { Stack } from 'expo-router';

// A render error inside the booking flow shows the branded recoverable
// screen scoped to this stack — the client retries in place instead of the
// whole app remounting. (Native crashes bypass any JS boundary; those are
// prevented at the source, e.g. the min/max zoom pairing on the map.)
export { ErrorBoundary } from '../_layout';

export default function BookingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FAFAFA' } }} />
  );
}
