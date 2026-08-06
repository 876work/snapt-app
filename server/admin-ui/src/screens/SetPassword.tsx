import { useState, type FormEvent } from 'react';
import mark from '../assets/snapt-icon.png';

// Invite redemption — reached from the emailed set-password link, so it must
// render without a signed-in session. On success: portal invitees go to the
// login form; app users are told to open the app.
export function SetPassword() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'portal' | 'app' | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== confirm) return setError('Passwords don’t match.');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/v1/admin/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const body = (await res.json()) as { set?: boolean; kind?: 'portal' | 'app'; error?: string };
      if (!res.ok || !body.set) throw new Error(body.error ?? 'Could not set the password');
      setDone(body.kind ?? 'portal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-col">
        <div className="login-brand">
          <img src={mark} alt="" />
          <div className="wordmark">Snapt</div>
          <div className="tagline">Set your password</div>
        </div>

        {done ? (
          <div className="login-card">
            <h1>You’re all set</h1>
            <div className="sub">
              {done === 'portal' ? (
                <>
                  Your password is saved. <a href="/admin">Sign in to the admin portal →</a>
                </>
              ) : (
                'Your password is saved. Open the Snapt app and sign in with your email.'
              )}
            </div>
          </div>
        ) : !token ? (
          <div className="login-card">
            <h1>Link missing its token</h1>
            <div className="sub">Open the link from your email again, or ask for a new invite.</div>
          </div>
        ) : (
          <form className="login-card" onSubmit={submit}>
            <h1>Choose a password</h1>
            <div className="sub">At least 10 characters. This link works once.</div>
            <label htmlFor="pw">New password</label>
            <input
              id="pw"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <label htmlFor="pw2">Repeat it</label>
            <input
              id="pw2"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </button>
            {error && <div className="err">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
