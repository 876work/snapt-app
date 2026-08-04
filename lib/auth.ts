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

// --- OAuth (Google / Apple) -----------------------------------------------
// Native token flows only (no browser redirect): the provider SDK returns an
// ID token and Supabase verifies it via signInWithIdToken. Supabase links an
// OAuth identity to an existing account with the same VERIFIED email, so an
// email signup who later taps "Continue with Google" lands in their one
// existing account — bookings/payments never split across duplicates.

/**
 * Read the `nonce` claim out of an ID token WITHOUT verifying it — GoTrue
 * does the real verification (signature, audience, expiry) server-side.
 *
 * GoTrue rejects a sign-in when the nonce we pass and the nonce claim in the
 * token disagree about EXISTING ("Passed nonce and nonce in id_token should
 * either both exist or not"). We never invent a nonce: we mirror exactly
 * what the provider put in the token, so the two can never diverge.
 *
 * Byte-level (latin1) decoding is deliberate: the only claim read here is
 * `nonce`, which is always ASCII. Multi-byte names elsewhere in the payload
 * may decode as mojibake, but they are never read and cannot break
 * JSON.parse (UTF-8 continuation bytes are ≥0x80, never control chars).
 */
function nonceClaimOf(idToken: string): string | null {
  try {
    const segment = idToken.split('.')[1];
    if (!segment) return null;
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let json = '';
    let buffer = 0;
    let bits = 0;
    for (const ch of padded) {
      if (ch === '=') break;
      const value = CHARS.indexOf(ch);
      if (value < 0) continue;
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        json += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    const claims = JSON.parse(json) as { nonce?: unknown };
    return typeof claims.nonce === 'string' && claims.nonce.length > 0 ? claims.nonce : null;
  } catch {
    return null; // unparseable → treat as "no nonce", same as before
  }
}

export type OAuthResult = AuthResult & {
  /** User dismissed the provider sheet — do nothing, show nothing. */
  cancelled?: boolean;
  /** Account created just now → route through onboarding like a signup. */
  isNewUser?: boolean;
  name?: string;
  email?: string;
};

/**
 * After signInWithIdToken: detect first-ever sign-in and capture the
 * provider-supplied name if the profile doesn't have one. Apple only sends
 * fullName on the FIRST authorization ever, so it must be written now or
 * it is lost permanently (private-relay users are unreachable otherwise).
 */
async function completeOAuthSignIn(providedName: string | null): Promise<OAuthResult> {
  const { data: auth } = await supabase!.auth.getUser();
  const user = auth.user;
  if (!user) return { error: 'Sign-in failed — try again.' };
  const isNewUser = Date.now() - new Date(user.created_at).getTime() < 120_000;

  const { data: prof } = await supabase!
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  let name = prof?.full_name ?? '';
  if (!name && providedName) {
    name = providedName;
    await supabase!
      .from('profiles')
      .update({ full_name: providedName, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    await supabase!.auth.updateUser({ data: { full_name: providedName } });
    useAuth.getState().setProfile({ name: providedName });
  }
  return { error: null, isNewUser, name, email: user.email ?? '' };
}

export async function signInWithGoogle(): Promise<OAuthResult> {
  if (!supabase) return { error: 'Google sign-in needs the live backend (demo mode).' };
  try {
    const { GoogleSignin, isSuccessResponse } = await import(
      '@react-native-google-signin/google-signin'
    );
    // NOTE: this package (MIT tier, v16) exposes no nonce option at all —
    // custom nonces are a paid-tier feature. Google's native iOS SDK still
    // stamps its own nonce into the ID token, so we must NOT assume the
    // token is nonce-free; see nonceClaimOf below.
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { error: null, cancelled: true };
    const idToken = response.data.idToken;
    if (!idToken) return { error: "Google didn't return a token — try again." };
    // Mirror the token's own nonce claim: both present, or both absent.
    // Passing a value we generated ourselves would be the "mixed" case that
    // GoTrue rejects, since the SDK never sends our value to Google.
    const nonce = nonceClaimOf(idToken);
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      ...(nonce ? { nonce } : {}),
    });
    if (error) return { error: error.message };
    const g = response.data.user;
    const googleName = g.name || [g.givenName, g.familyName].filter(Boolean).join(' ');
    return completeOAuthSignIn(googleName || null);
  } catch (e) {
    const code = (e as { code?: string }).code;
    const { statusCodes } = await import('@react-native-google-signin/google-signin');
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) {
      return { error: null, cancelled: true };
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { error: 'Google Play services is unavailable on this device.' };
    }
    return { error: 'Google sign-in failed — try again.' };
  }
}

export async function signInWithApple(): Promise<OAuthResult> {
  if (!supabase) return { error: 'Apple sign-in needs the live backend (demo mode).' };
  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) return { error: "Apple didn't return a token — try again." };
    // NONCE: deliberately none on both sides. No `nonce` is requested above,
    // so Apple issues a token with no nonce claim and we pass none — GoTrue's
    // "both exist or neither" rule is satisfied.
    //
    // Do NOT reuse Google's nonceClaimOf() here: the two providers have
    // opposite requirements. If a nonce is ever added to this flow, Apple
    // needs the SHA256 HASH of the raw value in signInAsync({ nonce }) and
    // the RAW value passed to signInWithIdToken — mirroring the token claim
    // would send the hash and fail. That change also needs expo-crypto,
    // which is a native module (rebuild, not an OTA update).
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) return { error: error.message };
    // fullName arrives ONLY on the first authorization ever. Private-relay
    // addresses (@privaterelay.appleid.com) are real, routable emails —
    // stored and used like any other, nothing special to do here.
    const n = credential.fullName;
    const providedName = n ? [n.givenName, n.familyName].filter(Boolean).join(' ') : '';
    return completeOAuthSignIn(providedName || null);
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
      return { error: null, cancelled: true };
    }
    return { error: 'Apple sign-in failed — try again.' };
  }
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
