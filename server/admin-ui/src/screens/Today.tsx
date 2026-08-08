import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import {
  EmptyState,
  Pill,
  SectionSkeleton,
  formatDuration,
  formatMoney,
  formatWhen,
  useNow,
} from '../components/ui';
import { Sparkline } from '../components/Sparkline';

/** This week vs last, as a signed % — the only number a sparkline needs. */
function weekDelta(days14: number[]): number | null {
  const last = days14.slice(7).reduce((s, v) => s + v, 0);
  const prev = days14.slice(0, 7).reduce((s, v) => s + v, 0);
  if (prev === 0 && last === 0) return null;
  if (prev === 0) return 100;
  return Math.round(((last - prev) / prev) * 100);
}

interface BookingLite {
  id: string;
  occasion: string | null;
  area: string | null;
  type: string;
  scheduled_at: string | null;
  duration_hours: number | null;
  price_usd: number;
  client_id: string;
  creator_id: string | null;
  client_name: string | null;
  creator_name: string | null;
}

interface DeliveryItem {
  booking_id: string;
  occasion: string | null;
  type: string;
  rush: boolean;
  due_at: string;
  hours_remaining: number;
  hours_late: number;
  state: 'on_track' | 'approaching' | 'late';
}

interface TodayData {
  server_time: string;
  grace_minutes: number;
  sparks: { bookings: number[]; revenue: number[] };
  deliveries: {
    late: number;
    late_rush: number;
    approaching: number;
    approaching_rush: number;
    items: DeliveryItem[];
  };
  alerts: {
    id: string;
    alert_type: string;
    booking_id: string | null;
    detail: Record<string, unknown>;
    created_at: string;
    acknowledged_at: string | null;
    acknowledged_by_name: string | null;
  }[];
  active_sessions: {
    id: string;
    booking_id: string;
    session_active_at: string;
    booking: BookingLite;
  }[];
  upcoming: (BookingLite & {
    client_checked_in_at: string | null;
    creator_checked_in_at: string | null;
    grace_ends_at: string;
  })[];
  grace_watch: (BookingLite & {
    client_checked_in_at: string | null;
    creator_checked_in_at: string | null;
    grace_ends_at: string;
  })[];
  offers: (BookingLite & { offer_expires_at: string })[];
  decisions: {
    parked_applications: number;
    payouts: { creators: number; total_usd: number };
    applications: number;
    open_disputes: number;
    unassigned_bookings: number;
    moderation_reports: number;
    portfolio_pending: number;
  };
}

const REFRESH_MS = 30_000;

function BookingLine({ b }: { b: BookingLite }) {
  return (
    <div className="who grow">
      <div className="name">
        {b.occasion ?? b.type} · {b.client_name ?? 'client'}
        {b.creator_name ? ` → ${b.creator_name}` : ''}
      </div>
      <div className="sub">
        {b.area ?? (b.type === 'remote' ? 'remote' : '—')}
        {b.scheduled_at ? ` · ${formatWhen(b.scheduled_at)}` : ''} · {formatMoney(Number(b.price_usd))}
      </div>
    </div>
  );
}

export function Today() {
  const now = useNow(1000);
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['today'],
    queryFn: () => api<TodayData>('/v1/admin/today'),
    refetchInterval: REFRESH_MS,
  });

  const ack = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/alerts/${id}/ack`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['today'] }),
  });
  const resolveAlert = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/alerts/${id}/resolve`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['today'] }),
  });

  const unacked = data?.alerts.filter((a) => !a.acknowledged_at) ?? [];
  const acked = data?.alerts.filter((a) => a.acknowledged_at) ?? [];

  if (isError && !data) {
    return (
      <>
        <h1 className="page-title">Today</h1>
        <div className="section">
          <div className="card empty">
            <div className="glyph">⚠</div>
            {(error as Error).message}
            <div style={{ marginTop: 8, color: 'var(--faint)', fontSize: 12 }}>
              Retrying automatically — a sleeping server can take up to a minute to wake.
            </div>
          </div>
        </div>
      </>
    );
  }

  const decisionTiles = data
    ? [
        {
          to: '/payouts',
          value:
            data.decisions.payouts.creators > 0
              ? formatMoney(data.decisions.payouts.total_usd)
              : '0',
          label:
            data.decisions.payouts.creators > 0
              ? `pending payouts · ${data.decisions.payouts.creators} creator${data.decisions.payouts.creators === 1 ? '' : 's'}`
              : 'pending payouts',
          urgent: data.decisions.payouts.creators > 0,
        },
        // Parked-for-name-review sits ABOVE the ordinary queue: these carry
        // duplicate or mismatch flags, need thought, and are therefore the
        // ones most likely to be skipped.
        ...(data.decisions.parked_applications
          ? [{
              to: '/creators',
              value: data.decisions.parked_applications,
              label: 'parked for name review',
              urgent: true,
            }]
          : []),
        { to: '/creators', value: data.decisions.applications, label: 'applications to review', urgent: data.decisions.applications > 0 },
        { to: '/disputes', value: data.decisions.open_disputes, label: 'open disputes', urgent: data.decisions.open_disputes > 0 },
        { to: '/bookings?filter=unassigned', value: data.decisions.unassigned_bookings, label: 'unassigned bookings', urgent: data.decisions.unassigned_bookings > 0 },
        { to: '/moderation', value: data.decisions.moderation_reports + data.decisions.portfolio_pending, label: 'moderation queue', urgent: data.decisions.moderation_reports > 0 },
      ]
    : [];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title">Today</h1>
        <span className="page-sub num">
          {data
            ? `Live · updated ${Math.max(0, Math.round((now - dataUpdatedAt) / 1000))}s ago`
            : isError
              ? (error as Error).message
              : 'Loading — a cold server can take up to a minute…'}
        </span>
      </div>

      {/* Safety alerts: pinned above everything when present; when clear,
          a single quiet line so decisions are genuinely first. */}
      {isLoading ? (
        <div className="section">
          <SectionSkeleton rows={2} />
        </div>
      ) : data && data.alerts.length === 0 ? (
        <div className="section" style={{ marginTop: 14 }}>
          <div className="sub" style={{ color: 'var(--faint)', fontSize: 12.5 }}>
            ✓ No open safety alerts — SOS and safety reports pin here the moment they arrive.
          </div>
        </div>
      ) : (
        <div className="section">
          <h2>
            Safety &amp; alerts{' '}
            <span className="count num">
              {unacked.length ? `${unacked.length} unacknowledged` : ''}
            </span>
          </h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {unacked.map((a) => (
              <div key={a.id} className="card alert-card">
                <div className="grow" style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Pill status={a.alert_type === 'sos' ? 'sos' : undefined} tone={a.alert_type === 'sos' ? 'danger' : 'warn'}>
                      {a.alert_type.replace(/_/g, ' ')}
                    </Pill>
                    <span className="sub num" style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {formatWhen(a.created_at)} · {formatDuration(now - Date.parse(a.created_at))} ago
                    </span>
                  </div>
                  {Object.keys(a.detail ?? {}).length > 0 && (
                    <pre className="detail" style={{ fontFamily: 'inherit' }}>
                      {JSON.stringify(a.detail, null, 1).replace(/[{}"]/g, '').trim()}
                    </pre>
                  )}
                </div>
                <button className="btn danger" disabled={ack.isPending} onClick={() => ack.mutate(a.id)}>
                  Acknowledge
                </button>
              </div>
            ))}
            {acked.map((a) => (
              <div key={a.id} className="card alert-card acked">
                <div className="grow" style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Pill tone={a.alert_type === 'sos' ? 'danger' : 'warn'}>{a.alert_type.replace(/_/g, ' ')}</Pill>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      acknowledged by {a.acknowledged_by_name ?? 'admin'} · {formatWhen(a.acknowledged_at!)}
                    </span>
                  </div>
                </div>
                <button className="btn ghost" disabled={resolveAlert.isPending} onClick={() => resolveAlert.mutate(a.id)}>
                  Resolve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Everything needing a human decision — first thing, every morning.
          Only unmissable safety alerts sit above this. */}
      {/* DELIVERY CLOCK — above the decision queues because a missed
          delivery is already costing us, while a queue is only waiting.
          Rush is called out separately: the client paid for the speed. */}
      {data && (data.deliveries.late > 0 || data.deliveries.approaching > 0) && (
        <div className="section">
          <h2>Delivery clock</h2>
          <div className="tiles decisions">
            {data.deliveries.late > 0 && (
              <Link to="/bookings" className="card tile hot">
                <div className="value num">{data.deliveries.late}</div>
                <div className="label">
                  past delivery deadline
                  {data.deliveries.late_rush > 0 && ` · ${data.deliveries.late_rush} PAID RUSH`}
                </div>
              </Link>
            )}
            {data.deliveries.approaching > 0 && (
              <Link to="/bookings" className={`card tile ${data.deliveries.approaching_rush > 0 ? 'hot' : 'quiet'}`}>
                <div className="value num">{data.deliveries.approaching}</div>
                <div className="label">
                  approaching deadline
                  {data.deliveries.approaching_rush > 0 && ` · ${data.deliveries.approaching_rush} rush`}
                </div>
              </Link>
            )}
          </div>
          <div className="card" style={{ marginTop: 10, padding: 0 }}>
            {data.deliveries.items.map((d, i) => (
              <Link
                key={d.booking_id}
                to={`/bookings/${d.booking_id}`}
                className="row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line, #eee)',
                }}
              >
                <Pill tone={d.state === 'late' ? 'danger' : 'warn'}>
                  {d.state === 'late' ? `${d.hours_late}h late` : `${d.hours_remaining}h left`}
                </Pill>
                {d.rush && <Pill tone="brand">RUSH</Pill>}
                <span style={{ flex: 1, fontSize: 13 }}>
                  {d.occasion ?? (d.type === 'remote' ? 'Remote edit' : 'Session')}
                </span>
                <span className="k" style={{ fontSize: 12 }}>
                  due {formatWhen(d.due_at)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h2>Needs a decision</h2>
        {isLoading ? (
          <SectionSkeleton rows={2} />
        ) : (
          <div className="tiles decisions">
            {decisionTiles.map((t) => (
              <Link key={t.label} to={t.to} className={`card tile ${t.urgent ? 'hot' : 'quiet'}`}>
                <div className="value num">{t.value}</div>
                <div className="label">{t.label}</div>
              </Link>
            ))}
            {data &&
              (
                [
                  { label: 'bookings · 14 days', points: data.sparks.bookings, money: false },
                  { label: 'revenue · 14 days', points: data.sparks.revenue, money: true },
                ] as const
              ).map((s) => {
                const delta = weekDelta(s.points);
                const weekTotal = s.points.slice(7).reduce((a, v) => a + v, 0);
                return (
                  <Link key={s.label} to="/analytics" className="card tile spark-tile quiet" style={{ borderStyle: 'solid' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="num" style={{ fontWeight: 800, fontSize: 19, color: 'var(--ink-2)' }}>
                        {s.money ? formatMoney(Math.round(weekTotal * 100) / 100) : weekTotal}
                      </span>
                      {delta != null && (
                        <span className={`delta num ${delta >= 0 ? 'up' : 'down'}`}>
                          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
                        </span>
                      )}
                    </div>
                    <Sparkline points={s.points} width={120} height={26} stroke={delta != null && delta < 0 ? 'var(--danger)' : 'var(--brand)'} />
                    <div className="label">{s.label}</div>
                  </Link>
                );
              })}
          </div>
        )}
      </div>

      {/* Grace window — the bookings most likely to become no-shows. */}
      <div className="section">
        <h2>
          Grace window <span className="count num">{data?.grace_watch.length || ''}</span>
        </h2>
        {isLoading ? (
          <SectionSkeleton />
        ) : data!.grace_watch.length === 0 ? (
          <EmptyState glyph="✓">Nothing near its grace window.</EmptyState>
        ) : (
          <div className="card row-list">
            {data!.grace_watch.map((b) => {
              const past = now > Date.parse(b.grace_ends_at);
              return (
                <div className="row" key={b.id}>
                  <BookingLine b={b} />
                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {b.client_checked_in_at ? 'client ✓' : 'client —'} · {b.creator_checked_in_at ? 'creator ✓' : 'creator —'}
                  </span>
                  {past ? (
                    <Pill tone="danger">
                      grace passed {formatDuration(now - Date.parse(b.grace_ends_at))} ago
                    </Pill>
                  ) : (
                    <Pill tone="warn">grace ends in {formatDuration(Date.parse(b.grace_ends_at) - now)}</Pill>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sessions running right now. */}
      <div className="section">
        <h2>
          Active sessions <span className="count num">{data?.active_sessions.length || ''}</span>
        </h2>
        {isLoading ? (
          <SectionSkeleton />
        ) : data!.active_sessions.length === 0 ? (
          <EmptyState glyph="◎">No sessions in progress right now.</EmptyState>
        ) : (
          <div className="card row-list">
            {data!.active_sessions.map((s) => (
              <div className="row" key={s.id}>
                <BookingLine b={s.booking} />
                <Pill tone="ok">active</Pill>
                <span className="mono-time num">{formatDuration(now - Date.parse(s.session_active_at))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Offers awaiting a creator's yes/no, with the countdown. */}
      <div className="section">
        <h2>
          Offers awaiting acceptance <span className="count num">{data?.offers.length || ''}</span>
        </h2>
        {isLoading ? (
          <SectionSkeleton />
        ) : data!.offers.length === 0 ? (
          <EmptyState glyph="✓">No offers waiting on a creator.</EmptyState>
        ) : (
          <div className="card row-list">
            {data!.offers.map((b) => {
              const left = Date.parse(b.offer_expires_at) - now;
              return (
                <div className="row" key={b.id}>
                  <BookingLine b={b} />
                  <Pill tone={left < 3 * 60_000 ? 'danger' : 'warn'}>
                    {left > 0 ? `${formatDuration(left)} left` : 'expiring…'}
                  </Pill>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Starting soon — confirmed sessions in the next 12 hours. */}
      <div className="section">
        <h2>
          Starting soon <span className="count num">{data?.upcoming.length || ''}</span>
        </h2>
        {isLoading ? (
          <SectionSkeleton />
        ) : data!.upcoming.length === 0 ? (
          <EmptyState glyph="—">No confirmed sessions in the next 12 hours.</EmptyState>
        ) : (
          <div className="card row-list">
            {data!.upcoming.map((b) => (
              <div className="row" key={b.id}>
                <BookingLine b={b} />
                <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {b.client_checked_in_at || b.creator_checked_in_at
                    ? `${b.client_checked_in_at ? 'client ✓' : 'client —'} · ${b.creator_checked_in_at ? 'creator ✓' : 'creator —'}`
                    : ''}
                </span>
                <Pill tone="info">in {formatDuration(Date.parse(b.scheduled_at!) - now)}</Pill>
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  );
}
