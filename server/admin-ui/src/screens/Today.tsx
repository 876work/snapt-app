import type { ReactNode } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { api } from '../api';
import { Pill, formatDuration, formatMoney, formatWhen, useNow } from '../components/ui';

/**
 * TODAY — structure after the TeamHub reference, colour after Snapt.
 *
 * Four things it does differently from the reference, all forced by this
 * instance's actual size (19 users, 13 creators, single-digit bookings):
 *
 *   - No week-over-week percentages. The real 14-day series is
 *     [0,1,0,0,0,0,1,0,12,0,7,3,8,0] — 2 last week against 30 this week,
 *     which the old delta maths rendered as "▲ 1400%". That is not a trend,
 *     it is the app being tested. Raw counts instead.
 *   - No categorical bar chart or 0–100 breakdown. Two bars over four
 *     bookings reads as a bug.
 *   - No tabbed sortable table. Five tabs over four rows is chrome.
 *   - Health tiles are PERMANENT. Delivery clock and unbookable creators
 *     used to render only when something was wrong, so a healthy system and
 *     a broken query looked identical: nothing on screen. They now always
 *     show, reading 0 with an "all clear" tag.
 *
 * Every block renders loading, failed and empty as three visibly different
 * things. A failed fetch never renders as a zero — that is the same rule the
 * app follows, and the reason `Block` takes the query state rather than just
 * the data.
 */

/* ------------------------------------------------------------------ types */

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
  creators_unbookable?: {
    total: number;
    no_hours: number;
    paused: number;
    items: { user_id: string; name: string | null; reason: string }[];
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
  active_sessions: { id: string; booking_id: string; session_active_at: string; booking: BookingLite }[];
  upcoming: (BookingLite & { client_checked_in_at: string | null; creator_checked_in_at: string | null; grace_ends_at: string })[];
  grace_watch: (BookingLite & { client_checked_in_at: string | null; creator_checked_in_at: string | null; grace_ends_at: string })[];
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

/* ------------------------------------------------------------- primitives */

/**
 * The three states, made structural rather than remembered.
 *
 * `failed` deliberately renders instead of the children — never alongside
 * and never as a 0. A tile that shows "0 late deliveries" when the request
 * actually failed is worse than a tile showing nothing.
 */
function Block({
  status,
  isEmpty,
  emptyText,
  errorText,
  loadingText = 'Loading…',
  children,
}: {
  status: 'pending' | 'error' | 'success';
  isEmpty?: boolean;
  emptyText: string;
  errorText?: string;
  loadingText?: string;
  children: ReactNode;
}) {
  if (status === 'pending') {
    return (
      <div className="blk-state loading">
        <span className="g">◍</span>
        {loadingText}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="blk-state failed">
        <span className="g">⚠</span>
        {errorText ?? "Couldn't load this — retrying."}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="blk-state empty">
        <span className="g">✓</span>
        {emptyText}
      </div>
    );
  }
  return <>{children}</>;
}

/* -------------------------------------------------------------- the screen */

export function Today() {
  const now = useNow(1000);
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['today'],
    queryFn: () => api<TodayData>('/v1/admin/today'),
    refetchInterval: REFRESH_MS,
  });
  const { data, status, dataUpdatedAt } = q;
  // A refetch failure while stale data is on screen should not blank the
  // page — but it must not be presented as fresh either.
  const stale = q.isError && !!data;

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

  const d = data?.decisions;
  const decisionTotal = d
    ? d.applications + d.parked_applications + d.open_disputes + d.unassigned_bookings + d.moderation_reports + d.portfolio_pending
    : 0;

  const queues = d
    ? [
        { to: '/payouts', n: d.payouts.creators > 0 ? formatMoney(d.payouts.total_usd) : '0', lab: d.payouts.creators > 0 ? `pending payouts · ${d.payouts.creators} creator${d.payouts.creators === 1 ? '' : 's'}` : 'pending payouts', urgent: d.payouts.creators > 0 },
        { to: '/creators', n: d.parked_applications, lab: 'parked for name review', urgent: d.parked_applications > 0 },
        { to: '/creators', n: d.applications, lab: 'applications to review', urgent: d.applications > 0 },
        { to: '/disputes', n: d.open_disputes, lab: 'open disputes', urgent: d.open_disputes > 0 },
        { to: '/bookings?filter=unassigned', n: d.unassigned_bookings, lab: 'unassigned bookings', urgent: d.unassigned_bookings > 0 },
        { to: '/moderation', n: d.moderation_reports + d.portfolio_pending, lab: 'moderation queue', urgent: d.moderation_reports > 0 },
      ]
    : [];

  // 14 days of bookings, as a shape. Recharts, already a dependency — no
  // axis furniture, because 14 points with 8 zeros cannot carry a grid.
  const series = (data?.sparks.bookings ?? []).map((v, i) => ({
    d: new Date(Date.now() - (13 - i) * 86400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    v,
  }));
  const bookings7 = (data?.sparks.bookings ?? []).slice(7).reduce((s, v) => s + v, 0);
  const bookingsPrev7 = (data?.sparks.bookings ?? []).slice(0, 7).reduce((s, v) => s + v, 0);
  const revenue7 = (data?.sparks.revenue ?? []).slice(7).reduce((s, v) => s + v, 0);

  // One chronological column: everything time-sensitive, soonest first.
  const timeline = data
    ? [
        ...data.active_sessions.map((s) => ({
          key: `s${s.id}`,
          at: Date.parse(s.session_active_at),
          tone: '' as const,
          when: `running ${formatDuration(now - Date.parse(s.session_active_at))}`,
          title: `${s.booking.occasion ?? 'Session'} · ${s.booking.client_name ?? 'client'}`,
          sub: s.booking.creator_name ? `with ${s.booking.creator_name}` : 'session in progress',
          to: `/bookings/${s.booking_id}`,
        })),
        ...data.grace_watch.map((b) => ({
          key: `g${b.id}`,
          at: Date.parse(b.grace_ends_at),
          tone: (now > Date.parse(b.grace_ends_at) ? 'hot' : 'warn') as 'hot' | 'warn',
          when: now > Date.parse(b.grace_ends_at) ? `grace passed ${formatDuration(now - Date.parse(b.grace_ends_at))} ago` : `grace ends in ${formatDuration(Date.parse(b.grace_ends_at) - now)}`,
          title: `${b.occasion ?? 'Session'} · ${b.client_name ?? 'client'}`,
          sub: `${b.client_checked_in_at ? 'client ✓' : 'client —'} · ${b.creator_checked_in_at ? 'creator ✓' : 'creator —'}`,
          to: `/bookings/${b.id}`,
        })),
        ...data.offers.map((b) => ({
          key: `o${b.id}`,
          at: Date.parse(b.offer_expires_at),
          tone: (Date.parse(b.offer_expires_at) - now < 3 * 60_000 ? 'hot' : 'warn') as 'hot' | 'warn',
          when: Date.parse(b.offer_expires_at) > now ? `offer expires in ${formatDuration(Date.parse(b.offer_expires_at) - now)}` : 'offer expiring…',
          title: `${b.occasion ?? 'Offer'} · ${b.creator_name ?? 'creator'}`,
          sub: 'waiting on acceptance',
          to: `/bookings/${b.id}`,
        })),
        ...data.upcoming.map((b) => ({
          key: `u${b.id}`,
          at: Date.parse(b.scheduled_at!),
          tone: '' as const,
          when: `starts in ${formatDuration(Date.parse(b.scheduled_at!) - now)}`,
          title: `${b.occasion ?? 'Session'} · ${b.client_name ?? 'client'}`,
          sub: b.area ?? (b.type === 'remote' ? 'remote' : '—'),
          to: `/bookings/${b.id}`,
        })),
      ].sort((a, b) => a.at - b.at)
    : [];

  const unbookable = data?.creators_unbookable;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Today</h1>
        <span className="page-sub num" style={{ margin: 0 }}>
          {stale
            ? `Showing last good data — refresh failed ${Math.max(0, Math.round((now - dataUpdatedAt) / 1000))}s ago`
            : data
              ? `Live · updated ${Math.max(0, Math.round((now - dataUpdatedAt) / 1000))}s ago`
              : status === 'error'
                ? 'Could not reach the server'
                : 'Loading — a cold server can take up to a minute…'}
        </span>
      </div>

      {/* SAFETY — pinned above the grid. Not a statistic; an interruption. */}
      <div className="t-card" style={{ marginBottom: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Safety &amp; alerts</h2>
          {unacked.length > 0 && <span className="meta">{unacked.length} unacknowledged</span>}
        </div>
        <Block
          status={status}
          isEmpty={data?.alerts.length === 0}
          emptyText="No open safety alerts — SOS and safety reports pin here the moment they arrive."
          errorText="Couldn't load alerts. This is the one block that must not be trusted while it says this."
        >
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
        </Block>
      </div>

      <div className="today-grid">
        {/* ---------------- left column ---------------- */}
        <div>
          {/* Hero + the two health stats that used to vanish when healthy. */}
          <div className="stat-row">
            <Link to="/creators" className="stat-hero">
              <div className="glyph">◆</div>
              <div>
                <div className="figure">
                  <span className="n num">{status === 'success' ? decisionTotal : '—'}</span>
                </div>
                <div className="cap">
                  {status === 'error'
                    ? 'queue unavailable'
                    : decisionTotal === 0
                      ? 'nothing waiting on you'
                      : 'things needing a decision'}
                </div>
              </div>
            </Link>

            <div className="stat-col">
              <Link to="/bookings" className={`stat-small ${data && data.deliveries.late > 0 ? 'is-hot' : 'is-ok'}`}>
                <div className="glyph">⏱</div>
                <div className="body">
                  <div className="lab">Late deliveries</div>
                  <div className="n num">{status === 'success' ? data!.deliveries.late : '—'}</div>
                </div>
                {status === 'success' && (
                  <span className={`tag ${data!.deliveries.late > 0 ? 'hot' : 'ok'}`}>
                    {data!.deliveries.late > 0
                      ? `${data!.deliveries.late_rush} rush`
                      : data!.deliveries.approaching > 0
                        ? `${data!.deliveries.approaching} due soon`
                        : 'all clear'}
                  </span>
                )}
              </Link>

              <Link to="/creators" className={`stat-small ${unbookable && unbookable.total > 0 ? 'is-hot' : 'is-ok'}`}>
                <div className="glyph">☺</div>
                <div className="body">
                  <div className="lab">Creators who can't be booked</div>
                  <div className="n num">{status === 'success' ? (unbookable?.total ?? 0) : '—'}</div>
                </div>
                {status === 'success' && (
                  <span className={`tag ${unbookable && unbookable.total > 0 ? 'hot' : 'ok'}`}>
                    {unbookable && unbookable.total > 0 ? `${unbookable.no_hours} no hours` : 'all bookable'}
                  </span>
                )}
              </Link>
            </div>
          </div>

          {/* Decision queues — the reference's vacancy grid. */}
          <div className="t-card">
            <div className="t-card-head">
              <h2>Needs a decision</h2>
              <Link className="meta" to="/bookings">All bookings →</Link>
            </div>
            <Block status={status} emptyText="Nothing queued." errorText="Couldn't load the decision queues.">
              <div className="queue-grid">
                {queues.map((t) => (
                  <Link key={t.lab} to={t.to} className={`queue-item ${t.urgent ? 'urgent' : ''}`}>
                    <div className="n num">{t.n}</div>
                    <div className="lab">{t.lab}</div>
                  </Link>
                ))}
              </div>
            </Block>
          </div>

          {/* Delivery clock — now permanent, so healthy is visibly healthy. */}
          <div className="t-card">
            <div className="t-card-head">
              <h2>Delivery clock</h2>
              {status === 'success' && (
                <span className="meta">
                  {data!.deliveries.late + data!.deliveries.approaching === 0 ? 'every job inside its window' : `${data!.deliveries.items.length} needing attention`}
                </span>
              )}
            </div>
            <Block
              status={status}
              isEmpty={data?.deliveries.items.length === 0}
              emptyText="Nothing late or approaching. The clock is running and every job is inside its window."
              errorText="Couldn't load the delivery clock — this is NOT the same as nothing being late."
            >
              <div style={{ display: 'grid', gap: 8 }}>
                {data?.deliveries.items.map((x) => (
                  <Link key={x.booking_id} to={`/bookings/${x.booking_id}`} className="tl-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Pill tone={x.state === 'late' ? 'danger' : 'warn'}>
                      {x.state === 'late' ? `${x.hours_late}h late` : `${x.hours_remaining}h left`}
                    </Pill>
                    {x.rush && <Pill tone="brand">RUSH</Pill>}
                    <span style={{ flex: 1, fontSize: 13 }}>{x.occasion ?? (x.type === 'remote' ? 'Remote edit' : 'Session')}</span>
                    <span className="tl-when">due {formatWhen(x.due_at)}</span>
                  </Link>
                ))}
              </div>
            </Block>
          </div>

          {/* Unbookable creator detail, only when there is any. */}
          {status === 'success' && unbookable && unbookable.total > 0 && (
            <div className="t-card">
              <div className="t-card-head">
                <h2>Unbookable creators</h2>
                <span className="meta">{unbookable.no_hours} with no hours · {unbookable.paused} paused</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {unbookable.items.map((c) => (
                  <Link key={c.user_id} to={`/creators/${c.user_id}`} className="tl-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{c.name ?? c.user_id.slice(0, 8)}</span>
                    <span className="tl-when">{c.reason}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---------------- right column ---------------- */}
        <div>
          {/* Volume, stated as counts. No percentage: see the header comment. */}
          <div className="t-card">
            <div className="t-card-head">
              <h2>Bookings</h2>
              <Link className="meta" to="/analytics">Analytics →</Link>
            </div>
            <Block
              status={status}
              isEmpty={series.length > 0 && series.every((p) => p.v === 0)}
              emptyText="No bookings in the last 14 days."
              errorText="Couldn't load booking volume."
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
                <span className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em' }}>{bookings7}</span>
                <span className="meta">this week · {bookingsPrev7} last week</span>
              </div>
              <div style={{ height: 132, margin: '0 -6px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}>
                    <defs>
                      <linearGradient id="bkFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="d" tick={{ fontSize: 10, fill: 'var(--faint)' }} axisLine={false} tickLine={false} interval={3} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 12, boxShadow: 'var(--shadow)' }}
                      labelStyle={{ color: 'var(--muted)' }}
                      formatter={(v) => [Number(v ?? 0), 'bookings']}
                    />
                    <Area type="monotone" dataKey="v" stroke="var(--brand)" strokeWidth={2} fill="url(#bkFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="meta" style={{ marginTop: 8 }}>
                {formatMoney(Math.round(revenue7 * 100) / 100)} charged this week
              </div>
            </Block>
          </div>

          {/* Live ops as one chronological column — the reference's Schedules.
              Four separate near-empty sections used to be most of this page. */}
          <div className="t-card">
            <div className="t-card-head">
              <h2>Live operations</h2>
              {status === 'success' && timeline.length > 0 && <span className="meta">{timeline.length} in flight</span>}
            </div>
            <Block
              status={status}
              isEmpty={timeline.length === 0}
              emptyText="Nothing in flight — no sessions running, no offers pending, nothing starting soon."
              errorText="Couldn't load live operations."
            >
              <div className="tl">
                {timeline.map((t) => (
                  <div key={t.key} className={`tl-item ${t.tone}`}>
                    <Link to={t.to} className="tl-card">
                      <div className="tl-when">{t.when}</div>
                      <div className="tl-title">{t.title}</div>
                      <div className="tl-sub">{t.sub}</div>
                    </Link>
                  </div>
                ))}
              </div>
            </Block>
          </div>
        </div>
      </div>
    </>
  );
}
