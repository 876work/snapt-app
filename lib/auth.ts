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
): Promise<AuthResult & { needsConfirmation?: boolean }> {
  if (!supabase) {
    // Mock mode: the verify + currency screens complete sign-in as before.
    return { error: null };
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });
  if (error) return { error: error.message };
  // Profile row is created by the on_auth_user_created trigger.
  // With email confirmations enabled (production) there is no session yet —
  // the user must enter the emailed code before they are signed in.
  return { error: null, needsConfirmation: !data.session };
}

/**
 * Confirm signup with the 6-digit code GoTrue emailed. On success a session
 * is established and onAuthStateChange signs the store in. Requires the
 * hosted "Confirm signup" email template to include {{ .Token }}.
 */
export async function verifySignupCode(email: string, code: string): Promise<AuthResult> {
  if (!supabase) return { error: null };
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' });
  if (error) return { error: error.message };
  return { error: null };
}

export async function resendSignupCode(email: string): Promise<AuthResult> {
  if (!supabase) return { error: null };
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) return { error: error.message };
  return { error: null };
}

// --- Password reset (GoTrue recovery OTP). Requires the hosted "Reset
// Password" email template to include {{ .Token }}, same as signup.

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!supabase) return { error: null };
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) return { error: error.message };
  return { error: null };
}

/** Verifying the recovery code establishes a session for the account. */
export async function verifyResetCode(email: string, code: string): Promise<AuthResult> {
  if (!supabase) return { error: null };
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (error) return { error: error.message };
  return { error: null };
}

/** Set the new password on the recovery session. User ends up signed in. */
export async function completePasswordReset(newPassword: string): Promise<AuthResult> {
  if (!supabase) return { error: null };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
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
  // Best-effort: stop this device receiving the account's pushes first,
  // while the session token is still valid for the unregister call.
  try {
    const { unregisterPush } = await import('./push');
    await unregisterPush();
  } catch {
    // never block sign-out
  }
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
  // Display peg (xcd_per_usd) comes from server config — fire-and-forget;
  // the bundled fallback covers the first frames and offline mock mode.
  import('./api').then(({ apiConfigured, syncDisplayRates }) => {
    if (apiConfigured) syncDisplayRates();
  });
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
      // Creator status is server-authoritative — fetched on every launch and
      // sign-in; the client never decides or caches its way into creator
      // mode. Selected mode persists across relaunches but is demoted to
      // client whenever the server status is anything but approved.
      import('./api').then(({ apiConfigured, fetchCreatorStatus }) => {
        if (!apiConfigured) return;
        Promise.all([
          fetchCreatorStatus(),
          import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) =>
            AsyncStorage.getItem('snapt.mode').catch(() => null),
          ),
        ]).then(([status, savedMode]) => {
          const auth = useAuth.getState();
          if (status) auth.setCreatorStatus(status);
          const effective = status ?? auth.creatorStatus;
          if (savedMode === 'creator' && effective === 'approved') {
            auth.setMode('creator');
          } else if (auth.mode === 'creator' && effective !== 'approved') {
            auth.setMode('client');
          }
        });
      });
      // Keep this device's push token bound to the signed-in account
      // (no-ops unless the user already granted notification permission).
      import('./push').then((p) => p.registerIfGranted());
    } else if (state.signedIn) {
      state.signOut();
    }
  });
  supabase.auth.getSession().then(() => useAuth.getState().setHydrated());
}
