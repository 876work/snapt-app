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

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? formatTime(iso)
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + formatTime(iso);
}
