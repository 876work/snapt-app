import { Redirect } from 'expo-router';
import { useAuth } from '../lib/store';

export default function Index() {
  const signedIn = useAuth((s) => s.signedIn);
  const hydrated = useAuth((s) => s.hydrated);
  const profileComplete = useAuth((s) => s.profileComplete);
  const mode = useAuth((s) => s.mode);
  const creatorStatus = useAuth((s) => s.creatorStatus);
  // Wait for persisted-session restore before routing (instant in mock mode).
  if (!hydrated) return null;
  if (!signedIn) return <Redirect href="/(auth)/welcome" />;
  /**
   * Accounts created before the four fields were required — and every OAuth
   * account, since neither provider returns a phone number — get the
   * completion step once, on next launch.
   *
   * Only an explicit `false` redirects. `null` means the profiles row hasn't
   * been read back yet, and treating unknown as incomplete would flash this
   * screen at everyone for the moment before hydration lands.
   */
  if (profileComplete === false) return <Redirect href="/(auth)/complete-profile" />;
  /**
   * A creator working in creator mode lands on their WORK QUEUE.
   *
   * Their queue was only reachable via Profile → Creator, so every launch put
   * an approved creator on the client home — a screen for booking creators,
   * shown to the creator. The mode they last chose is persisted and
   * revalidated against server status on every launch (lib/auth.ts), so this
   * cannot strand someone whose approval was withdrawn.
   */
  if (mode === 'creator' && creatorStatus === 'approved') return <Redirect href="/creator" />;
  return <Redirect href="/(app)/home" />;
}
