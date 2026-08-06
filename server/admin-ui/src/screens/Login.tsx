import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import mark from '../assets/snapt-icon.png';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingSecs, setWaitingSecs] = useState(0);

  // The server sleeps on Render's free tier; a slow sign-in is it waking,
  // not a failure — the ticking counter is what makes that believable.
  useEffect(() => {
    if (!busy) {
      setWaitingSecs(0);
      return;
    }
    const t = setInterval(() => setWaitingSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
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
          <div className="tagline">Admin portal</div>
        </div>

        <form className="login-card" onSubmit={submit}>
          <h1>Welcome back</h1>
          <div className="sub">Sign in with your admin account.</div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@snaptcarib.app"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="btn" type="submit" disabled={busy}>
            {busy ? (waitingSecs > 3 ? `Waking the server… ${waitingSecs}s` : 'Signing in…') : 'Sign in'}
          </button>
          {error && <div className="err">{error}</div>}
          {busy && waitingSecs > 3 && (
            <div className="waking">
              The server sleeps when idle and takes 30–60 seconds to wake. Hold on — this is
              normal, not broken.
            </div>
          )}
        </form>

        <div className="login-foot">
          First sign-in after a quiet period can take up to a minute while the server wakes.
        </div>
      </div>
    </div>
  );
}
