// Thin fetch wrapper: bearer token, JSON, and errors that distinguish an
// expired session from a cold-starting server (Render free tier sleeps —
// the first request can take 30–60s and must not read as "broken").

const TOKEN_KEY = 'snapt.admin.jwt';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fired when the API says our token is no longer good. */
export const sessionExpired = new EventTarget();

/** Authenticated file download (CSV exports) — bearer token, blob, save-as. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken() ?? ''}`,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server — it may be waking up (free tier). Retrying…');
  }
  if (res.status === 401 || res.status === 403) {
    let message = 'Session expired — sign in again.';
    try {
      const body = (await res.json()) as { error?: string };
      // A role rejection is not an expired session; keep the user signed in.
      if (res.status === 403 && body.error?.includes('role')) {
        throw new ApiError(403, body.error);
      }
      if (body.error) message = body.error;
    } catch (err) {
      if (err instanceof ApiError) throw err;
    }
    sessionExpired.dispatchEvent(new Event('expired'));
    throw new ApiError(res.status, message);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}
