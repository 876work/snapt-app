import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken, sessionExpired } from './api';

export type Role = 'admin' | 'support' | 'moderator';

export interface Identity {
  admin_id: string;
  role: Role;
  name: string;
  email: string | null;
}

interface AuthState {
  identity: Identity | null;
  /** true while the stored token is being validated on first load */
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [restoring, setRestoring] = useState<boolean>(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    api<Identity>('/v1/admin/me')
      .then((me) => {
        if (!cancelled) setIdentity(me);
      })
      .catch(() => {
        /* expired token → sessionExpired listener clears state */
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setIdentity(null);
    };
    sessionExpired.addEventListener('expired', onExpired);
    return () => sessionExpired.removeEventListener('expired', onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/v1/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(() => {
      throw new Error('Can’t reach the server — it may be waking up. Try again in ~30 seconds.');
    });
    let body: { access_token?: string; error?: string };
    try {
      body = await res.json();
    } catch {
      throw new Error(`Server responded ${res.status} while starting up — try again in ~30 seconds.`);
    }
    if (!res.ok || !body.access_token) throw new Error(body.error ?? 'Sign-in failed');
    setToken(body.access_token);
    setIdentity(await api<Identity>('/v1/admin/me'));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setIdentity(null);
  }, []);

  return (
    <AuthContext.Provider value={{ identity, restoring, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
