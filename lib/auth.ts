import { supabase, supabaseConfigured } from './supabase';
import { useAuth } from './store';

// Auth service: one call site for the screens, two implementations —
// Supabase when configured, the existing mock store otherwise.
// OAuth (Google/Apple/Facebook) is intentionally absent until Phase 7
// credentials exist; the buttons remain visual stubs.

export const realAuth = supabaseConfigured;

type AuthResult = { error: string | null };

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!supabase) {
    // Mock mode: the verify + currency screens complete sign-in as before.
    return { error: null };
  }
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });
  if (error) return { error: error.message };
  // Profile row is created by the on_auth_user_created trigger.
  return { error: null };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  if (!supabase) {
    useAuth.getState().signIn(email.split('@')[0], email);
    return { error: null };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOutEverywhere(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
  useAuth.getState().signOut();
}

/**
 * Call once at app root. In Supabase mode, restores a persisted session and
 * keeps the zustand store in sync with auth state changes. In mock mode,
 * marks the store hydrated immediately.
 */
export function initAuth(): void {
  const store = useAuth.getState();
  if (!supabase) {
    store.setHydrated();
    return;
  }
  supabase.auth.onAuthStateChange((_event, session) => {
    const state = useAuth.getState();
    if (session?.user) {
      const meta = (session.user.user_metadata ?? {}) as { full_name?: string };
      state.signIn(meta.full_name ?? '', session.user.email ?? '');
    } else if (state.signedIn) {
      state.signOut();
    }
  });
  supabase.auth.getSession().then(() => useAuth.getState().setHydrated());
}
