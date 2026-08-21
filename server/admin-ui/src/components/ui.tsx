import { useEffect, useState, type ReactNode } from 'react';

// Shared primitives: status pills with one consistent colour meaning
// everywhere, skeleton loaders (never spinners), and real empty states.

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral';

/** One status → colour mapping for the whole portal. */
const STATUS_TONE: Record<string, Tone> = {
  // bookings
  pending: 'warn',
  confirmed: 'info',
  completed: 'ok',
  cancelled: 'neutral',
  no_show: 'danger',
  disputed: 'danger',
  // vetting
  in_review: 'warn',
  approved: 'ok',
  rejected: 'neutral',
  suspended: 'danger',
  // A creator who has not begun vetting is not a problem, just not started —
  // it was falling through to the neutral default, which was right by luck.
  not_started: 'neutral',
  // payouts
  requested: 'warn',
  held: 'neutral',
  available: 'info',
  paid_out: 'ok',
  clawed_back: 'danger',
  // disputes
  open: 'warn',
  evidence_window: 'warn',
  under_review: 'info',
  resolved: 'ok',
  appealed: 'danger',
  closed: 'neutral',
  // alerts
  sos: 'danger',
  // roles
  admin: 'brand',
  support: 'info',
  moderator: 'neutral',
};

export function Pill({ status, tone, children }: { status?: string; tone?: Tone; children?: ReactNode }) {
  const resolved = tone ?? (status ? STATUS_TONE[status] ?? 'neutral' : 'neutral');
  return <span className={`pill ${resolved}`}>{children ?? status?.replace(/_/g, ' ')}</span>;
}

export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

/** Placeholder for a whole section while it loads. */
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={18} w={`${88 - i * 13}%`} />
      ))}
    </div>
  );
}

export function EmptyState({ glyph = '✓', children }: { glyph?: string; children: ReactNode }) {
  return (
    <div className="card empty">
      <div className="glyph">{glyph}</div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The three list states, made structural — the same rule Today follows.

   Loading, failed and genuinely-empty are three different facts about the
   world and must not share a shape. Before this, every list screen rendered
   all three through `EmptyState`: same card, same grey, same centring, one
   character of difference. A failed fetch therefore looked like an empty
   queue, which on Moderation and Payouts means "nothing needs you" — the
   most dangerous sentence the portal can print when it does not know.

   So: loading is skeleton rows (structure arriving), failed is a red panel
   with the reason and a retry (an event, not a state of the data), and empty
   is quiet and says what emptiness MEANS on this screen.
--------------------------------------------------------------------------- */

export function ListState({
  status,
  isEmpty,
  empty,
  error,
  errorHint,
  onRetry,
  rows = 5,
  children,
}: {
  status: 'pending' | 'error' | 'success';
  isEmpty?: boolean;
  /** What emptiness means here. Positive where empty is the healthy case. */
  empty: ReactNode;
  /** The real failure message — never a generic one when we have the reason. */
  error?: string;
  /**
   * What the failure means for THIS surface. The default speaks about a list;
   * a record page should say so in its own noun, or the reassurance reads as
   * boilerplate written for somewhere else.
   */
  errorHint?: ReactNode;
  onRetry?: () => void;
  rows?: number;
  children: ReactNode;
}) {
  if (status === 'pending') {
    return (
      <div className="lst-loading" aria-busy="true" aria-live="polite">
        {Array.from({ length: rows }, (_, i) => (
          <div className="lst-loading-row" key={i}>
            <Skeleton h={13} w={`${52 - (i % 3) * 9}%`} />
            <Skeleton h={11} w={`${34 - (i % 4) * 5}%`} style={{ marginTop: 7, opacity: 0.65 }} />
          </div>
        ))}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="lst-state failed" role="alert">
        <span className="g">⚠</span>
        <div className="msg">Couldn't load this.</div>
        <div className="why">{error ?? 'The request failed.'}</div>
        <div className="hint">
          {errorHint ?? 'This is not an empty list — the data could not be read, so nothing here is known.'}
        </div>
        {onRetry && (
          <button className="btn danger lst-retry" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="lst-state empty">
        <span className="g">✓</span>
        <div className="msg">{empty}</div>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * The one place the three states are DERIVED, so no screen has to remember
 * the rule.
 *
 * The subtlety is `keepPreviousData`. It leaves data on screen across a key
 * change, and that data answers the PREVIOUS question, not the current one.
 * Observed on production: switch Bookings from Disputed (0 rows) to
 * Completed while the request fails, and the previous empty result renders
 * as a confident "No completed bookings right now" — a failed fetch wearing
 * a green tick, which is the exact thing this batch exists to kill. So
 * placeholder data is never treated as an answer:
 *
 *   - placeholder on screen, still trying  → pending (skeletons, no claim)
 *   - placeholder on screen, request failed → error (we know nothing)
 *   - REAL data on screen, refetch failed   → success + stale (rows, warned)
 */
export function fetchState(q: {
  isPending: boolean;
  isError: boolean;
  isPlaceholderData?: boolean;
  data: unknown;
}): {
  state: 'pending' | 'error' | 'success';
  stale: boolean;
} {
  // Data that actually answers THIS query.
  const answered = q.data !== undefined && !q.isPlaceholderData;
  if (q.isError) return { state: answered ? 'success' : 'error', stale: answered };
  if (q.isPending || q.isPlaceholderData) return { state: 'pending', stale: false };
  return { state: 'success', stale: false };
}

/**
 * "Live · updated 4s ago" / "Showing last good data — refresh failed 12s ago".
 *
 * Screens that keep previous data across a refetch (keepPreviousData) will
 * happily show yesterday's rows forever if the server goes away. Today already
 * says so out loud; this is that sentence, once, for every screen that needs it.
 */
export function Freshness({
  status,
  isStale,
  updatedAt,
  loading = 'Loading — a cold server can take up to a minute…',
  failed = 'Could not reach the server',
}: {
  status: 'pending' | 'error' | 'success';
  /** Errored, but previous data is still on screen. */
  isStale: boolean;
  updatedAt: number;
  loading?: string;
  failed?: string;
}) {
  const now = useNow(1000);
  // dataUpdatedAt is 0 until this query key has succeeded ONCE. Subtracting
  // from it produced "updated 1786419147s ago" — the unix epoch, rendered as
  // an age — on any screen showing placeholder data from another key.
  const everLoaded = updatedAt > 0;
  const ago = Math.max(0, Math.round((now - updatedAt) / 1000));
  const text = isStale && everLoaded
    ? `Showing last good data — refresh failed ${ago}s ago`
    : status === 'success' && everLoaded
      ? `Live · updated ${ago}s ago`
      : status === 'error'
        ? failed
        : loading;
  return <span className={`freshness num${isStale ? ' stale' : ''}`}>{text}</span>;
}

/** Re-render every `ms` — drives elapsed timers and countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function formatDuration(totalMs: number): string {
  const neg = totalMs < 0;
  const s = Math.floor(Math.abs(totalMs) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const core = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
  return neg ? `-${core}` : core;
}

export function formatMoney(usd: number): string {
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * A byte count in the unit a person would say out loud.
 *
 * NULL IS NOT ZERO. booking_media.size_bytes is null for every file uploaded
 * before the column existed, and for any file whose size probe failed — so
 * unmeasured renders as '—'. Printing "0 B" for an unmeasured 60MB video is
 * the kind of confidently wrong number that gets believed, and this column
 * exists precisely to be trusted about file sizes.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal is the difference between "27.4 MB" and "27 MB" when you are
  // comparing a compressed file against its original; three digits in, it is
  // noise.
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * A timestamp that is never ambiguous about its day.
 *
 * Same-day values used to render as a bare time, so a column headed "Joined"
 * showed "23:03" next to "9 Aug 22:47" and you had to know that a missing
 * date meant today. It now says so. Every other day keeps its date, and the
 * label stays short enough for a table cell.
 */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Today ${formatTime(iso)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${formatTime(iso)}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + formatTime(iso);
}
