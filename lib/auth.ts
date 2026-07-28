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
 * Persist profile edits. The profiles row is the canonical record — the
 * payout queue and email notifications read name/phone from it. Email is
 * NOT written here in real mode: login email lives in auth and notification
 * email would silently diverge from it.
 */
export async function saveProfile(patch: {
  name: string;
  email: string;
  phone: string;
}): Promise<AuthResult> {
  const name = patch.name.trim();
  const phone = patch.phone.trim();
  if (supabase) {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { error: 'Not signed in.' };
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name, phone: phone || null, updated_at: new Date().toISOString() })
      .eq('id', auth.user.id);
    if (error) return { error: "Couldn't save your changes — try again." };
    // Keep auth metadata in sync so session hydration shows the same name.
    await supabase.auth.updateUser({ data: { full_name: name } });
    useAuth.getState().setProfile({ name, phone });
    return { error: null };
  }
  useAuth.getState().setProfile({ name, email: patch.email.trim(), phone });
  return { error: null };
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
      // The profiles row is canonical for display name/phone (metadata only
      // carries the signup name) — hydrate it so Edit profile shows saved
      // values and the phone reaches screens that render it.
      supabase!
        .from('profiles')
        .select('full_name, phone')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            useAuth.getState().setProfile({
              name: data.full_name || meta.full_name || '',
              phone: data.phone ?? '',
            });
          }
        });
      // Creator status is server-authoritative (vetting moved server-side in
      // Phase 1) — hydrate it so the creator app unlocks for real creators.
      import('./api').then(({ apiConfigured, fetchCreatorStatus }) => {
        if (!apiConfigured) return;
        fetchCreatorStatus().then((status) => {
          if (status) useAuth.getState().setCreatorStatus(status);
        });
      });
    } else if (state.signedIn) {
      state.signOut();
    }
  });
  supabase.auth.getSession().then(() => useAuth.getState().setHydrated());
}
