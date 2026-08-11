import { useState, type ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
} from 'recharts';
import { api, downloadFile } from '../api';
import { Freshness, ListState, Pill, fetchState, formatMoney } from '../components/ui';

/**
 * ANALYTICS — Today's chart treatment, and Today's honesty about scale.
 *
 * Two of these six are real time series and chart well at any volume: 30
 * daily buckets of bookings and of revenue. The other four are categorical,
 * and three of them cannot be drawn as bars on this instance's data without
 * looking broken:
 *
 *   - Creator utilisation: one bar per active creator. On production today
 *     that is 4 jobs held by 1 creator and 0 by the other 13 — thirteen
 *     zero-length bars. Stated as a figure and a list instead.
 *   - Bookings by area: 12 areas where the tail is eight areas tied at 1.
 *     A ranking read as a ranking, not as eight identical stubs.
 *   - Rating distribution: 5 buckets x 2 series over ONE rating in range.
 *     A distribution needs a population; below `RATINGS_MIN` it says so.
 *   - Cancellations by notice DOES survive: 7 / 3 / 8 / 3 across its four
 *     tiers is a real spread, so it stays a chart.
 *
 * Each fallback is a threshold, not a hard-coded choice, so these become
 * charts on their own once the data can carry them.
 */

interface SeriesData {
  from: string;
  to: string;
  bookings: { date: string; in_person: number; remote: number }[];
  revenue: { date: string; charged: number; fees: number }[];
  cancellations: { gt48h: number; h24_48: number; lt24h: number; unscheduled: number };
  utilisation: { name: string; jobs: number }[];
  active_creators: number;
  areas: { area: string; count: number }[];
  ratings: { client_to_creator: number[]; creator_to_client: number[] };
}

const GOLD = '#FFB800';
const INK = '#1A1A1A';
const RED = '#C23434';

/** Below these, a bar chart is drawing mostly nothing. */
const BARS_MIN = 3; // distinct non-zero categories
const RATINGS_MIN = 10; // ratings needed before a 5-bucket distribution means anything

const day = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

const PRESETS = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
] as const;

function rangeFor(preset: string): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - (Number(preset) - 1) * 86400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/* ---- Today's chart furniture, in one place so all six match ---- */

const AXIS = { tick: { fontSize: 11, fill: 'var(--faint)' }, axisLine: false, tickLine: false } as const;
const TOOLTIP = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid var(--line)',
    fontSize: 12,
    boxShadow: 'var(--shadow)',
  },
  labelStyle: { color: 'var(--muted)' },
} as const;
const LEGEND = { iconType: 'circle', wrapperStyle: { fontSize: 12 } } as const;
const GRID = 'var(--line)';

/** One card per panel — same radius, shadow and head as Today. */
function Panel({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
      <div className="t-card-head">
        <h2>{title}</h2>
        {meta && <span className="meta">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function ChartBody({
  isEmpty,
  empty,
  height = 240,
  children,
}: {
  isEmpty: boolean;
  empty: string;
  height?: number;
  children: React.ReactElement;
}) {
  if (isEmpty) {
    return (
      <div className="lst-inline empty">
        <span>—</span>
        <span>{empty}</span>
      </div>
    );
  }
  return (
    <div style={{ height, margin: '0 -6px' }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** The figure-and-pill fallback: a headline number, a ranking, and a reason. */
function FigureList({
  n,
  cap,
  rows,
  note,
}: {
  n: ReactNode;
  cap: string;
  rows: { label: string; value: ReactNode }[];
  note: string;
}) {
  return (
    <>
      <div className="fig-lead">
        <span className="n num">{n}</span>
        <span className="cap">{cap}</span>
      </div>
      {rows.length > 0 && (
        <div className="fig-list">
          {rows.map((r) => (
            <div className="fig-row" key={r.label}>
              <span className="lab">{r.label}</span>
              <span className="val">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="fig-note">{note}</div>
    </>
  );
}

export function Analytics() {
  const [preset, setPreset] = useState<string>('30');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const range = custom ?? rangeFor(preset);

  const q = useQuery({
    queryKey: ['analytics-series', range.from, range.to],
    queryFn: () => api<SeriesData>(`/v1/admin/analytics/series?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  const { state, stale } = fetchState(q);

  const [exportErr, setExportErr] = useState<string | null>(null);

  const totals = data
    ? {
        bookings: data.bookings.reduce((s, r) => s + r.in_person + r.remote, 0),
        charged: Math.round(data.revenue.reduce((s, r) => s + r.charged, 0) * 100) / 100,
        fees: Math.round(data.revenue.reduce((s, r) => s + r.fees, 0) * 100) / 100,
        cancels:
          data.cancellations.gt48h +
          data.cancellations.h24_48 +
          data.cancellations.lt24h +
          data.cancellations.unscheduled,
      }
    : null;

  const cancelRows = data
    ? [
        { tier: '>48h notice', count: data.cancellations.gt48h, fill: '#8AB98F' },
        { tier: '24–48h', count: data.cancellations.h24_48, fill: GOLD },
        { tier: '<24h', count: data.cancellations.lt24h, fill: RED },
        { tier: 'unscheduled', count: data.cancellations.unscheduled, fill: '#B9B9B9' },
      ]
    : [];

  const ratingRows = data
    ? [1, 2, 3, 4, 5].map((star) => ({
        star: `${star}★`,
        'client → creator': data.ratings.client_to_creator[star - 1],
        'creator → client': data.ratings.creator_to_client[star - 1],
      }))
    : [];

  const ratingTotal = data
    ? [...data.ratings.client_to_creator, ...data.ratings.creator_to_client].reduce((s, v) => s + v, 0)
    : 0;

  const workingCreators = (data?.utilisation ?? []).filter((u) => u.jobs > 0);
  const totalJobs = (data?.utilisation ?? []).reduce((s, u) => s + u.jobs, 0);
  const cancelSpread = cancelRows.filter((r) => r.count > 0).length;
  const areaTotal = (data?.areas ?? []).reduce((s, a) => s + a.count, 0);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Analytics</h1>
        <div className="chip-row">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`chip${!custom && preset === p.key ? ' active' : ''}`}
              onClick={() => {
                setCustom(null);
                setPreset(p.key);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="input"
            type="date"
            style={{ minWidth: 0, padding: '6px 8px' }}
            value={range.from}
            onChange={(e) => setCustom({ from: e.target.value, to: range.to })}
            aria-label="From date"
          />
          <span style={{ color: 'var(--muted)' }}>→</span>
          <input
            className="input"
            type="date"
            style={{ minWidth: 0, padding: '6px 8px' }}
            value={range.to}
            onChange={(e) => setCustom({ from: range.from, to: e.target.value })}
            aria-label="To date"
          />
        </div>
        <button
          className="btn ghost"
          onClick={() =>
            downloadFile(
              `/v1/admin/export/transactions?from=${range.from}&to=${range.to}`,
              `snapt-transactions-${range.from}-${range.to}.csv`,
            ).catch((e) => setExportErr((e as Error).message))
          }
        >
          Export transactions CSV
        </button>
      </div>
      <p className="page-sub num">
        {range.from} → {range.to}
        {totals
          ? ` · ${totals.bookings} bookings · ${formatMoney(totals.charged)} charged · ${formatMoney(totals.fees)} platform revenue`
          : ''}
      </p>
      <div style={{ marginTop: 4 }}>
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
      {exportErr && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', margin: '14px 0' }}>
          {exportErr}
        </div>
      )}

      <ListState
        status={state}
        error={(error as Error | null)?.message}
        onRetry={() => refetch()}
        rows={6}
        empty=""
      >
        {/* JSX children are built before ListState decides whether to show
            them, so every `data!` below would run during the pending render.
            The ternary is what actually defers them. */}
        {!data ? null : (
        <>
          <Panel title="Bookings over time" meta={`${totals?.bookings ?? 0} in range`}>
            <ChartBody
              isEmpty={totals!.bookings === 0}
              empty="No bookings in this range yet — they'll chart here as they come in."
            >
              <BarChart data={data!.bookings.map((r) => ({ ...r, label: day(r.date) }))}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} minTickGap={18} />
                <YAxis allowDecimals={false} {...AXIS} width={30} />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--bg)' }} />
                <Legend {...LEGEND} />
                <Bar dataKey="in_person" name="in person" stackId="b" fill={GOLD} />
                <Bar dataKey="remote" name="remote" stackId="b" fill={INK} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartBody>
          </Panel>

          <Panel title="Revenue over time" meta={`${formatMoney(totals?.charged ?? 0)} charged`}>
            <ChartBody
              isEmpty={totals!.charged === 0 && totals!.fees === 0}
              empty="No money moved in this range yet. Charges and platform fees will chart here."
            >
              <ComposedChart data={data!.revenue.map((r) => ({ ...r, label: day(r.date) }))}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} minTickGap={18} />
                <YAxis {...AXIS} width={46} tickFormatter={(v: number) => `$${v}`} />
                <Tooltip {...TOOLTIP} formatter={(v) => formatMoney(Number(v ?? 0))} />
                <Legend {...LEGEND} />
                <Area
                  dataKey="charged"
                  name="charged (net of refunds)"
                  fill="url(#revFill)"
                  stroke={GOLD}
                  strokeWidth={2}
                />
                <Line dataKey="fees" name="platform fee revenue" stroke={INK} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ChartBody>
          </Panel>

          {/* Four fixed tiers with a real spread on production — this one earns
              its bars, so it keeps them. */}
          <Panel title="Cancellations by notice" meta={`${totals?.cancels ?? 0} in range`}>
            {totals!.cancels === 0 ? (
              <div className="lst-inline empty">
                <span>✓</span>
                <span>No cancellations in this range — nothing leaking.</span>
              </div>
            ) : cancelSpread < BARS_MIN ? (
              <FigureList
                n={totals!.cancels}
                cap={`cancellation${totals!.cancels === 1 ? '' : 's'} in this range`}
                rows={cancelRows
                  .filter((r) => r.count > 0)
                  .map((r) => ({ label: r.tier, value: r.count }))}
                note={`Only ${cancelSpread} of the four notice tiers has anything in it, so the bars are stated as counts instead.`}
              />
            ) : (
              <ChartBody isEmpty={false} empty="" height={190}>
                <BarChart data={cancelRows} layout="vertical">
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} {...AXIS} />
                  <YAxis type="category" dataKey="tier" {...AXIS} width={96} />
                  <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--bg)' }} />
                  <Bar dataKey="count" name="cancellations" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                </BarChart>
              </ChartBody>
            )}
          </Panel>

          {/* One bar per creator only once enough creators have jobs to compare. */}
          <Panel
            title="Creator utilisation"
            meta={`${data!.active_creators} active creator${data!.active_creators === 1 ? '' : 's'}`}
          >
            {totalJobs === 0 ? (
              <div className="lst-inline empty">
                <span>—</span>
                <span>No completed jobs in this range yet. Once sessions complete, this fills in.</span>
              </div>
            ) : workingCreators.length < BARS_MIN ? (
              <FigureList
                n={totalJobs}
                cap={`completed job${totalJobs === 1 ? '' : 's'}, held by ${workingCreators.length} of ${data!.active_creators} active creator${data!.active_creators === 1 ? '' : 's'}`}
                rows={workingCreators.map((u) => ({
                  label: u.name,
                  value: `${u.jobs} job${u.jobs === 1 ? '' : 's'}`,
                }))}
                note={`The other ${data!.active_creators - workingCreators.length} completed nothing in this range. A bar per creator would be mostly empty bars, so it is a count until at least ${BARS_MIN} creators have work to compare.`}
              />
            ) : (
              <ChartBody isEmpty={false} empty="" height={Math.max(160, data!.utilisation.length * 34)}>
                <BarChart data={data!.utilisation} layout="vertical">
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} {...AXIS} />
                  <YAxis type="category" dataKey="name" {...AXIS} width={120} />
                  <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--bg)' }} />
                  <Bar dataKey="jobs" name="completed jobs" fill={GOLD} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartBody>
            )}
          </Panel>

          {/* A ranking, read as a ranking. The tail here is eight areas tied
              at one booking each — eight identical stubs say less than a list. */}
          <Panel title="Bookings by area" meta={`${data!.areas.length} area${data!.areas.length === 1 ? '' : 's'}`}>
            {data!.areas.length === 0 ? (
              <div className="lst-inline empty">
                <span>—</span>
                <span>No bookings in this range — area distribution appears once there are bookings.</span>
              </div>
            ) : (
              <FigureList
                n={data!.areas[0].count}
                cap={`in ${data!.areas[0].area}, the busiest of ${data!.areas.length} area${data!.areas.length === 1 ? '' : 's'} · ${areaTotal} booking${areaTotal === 1 ? '' : 's'} placed`}
                rows={data!.areas.map((a) => ({
                  label: a.area,
                  value: `${a.count} booking${a.count === 1 ? '' : 's'}`,
                }))}
                note="Ranked rather than plotted: most areas here carry a single booking, and bars of equal length say nothing a ranked count does not."
              />
            )}
          </Panel>

          {/* Five buckets x two directions needs a population, not a sample. */}
          <Panel title="Rating distribution" meta={`${ratingTotal} rating${ratingTotal === 1 ? '' : 's'}`}>
            {ratingTotal === 0 ? (
              <div className="lst-inline empty">
                <span>—</span>
                <span>No reviews in this range yet. Both directions chart here once ratings land.</span>
              </div>
            ) : ratingTotal < RATINGS_MIN ? (
              <FigureList
                n={ratingTotal}
                cap={`rating${ratingTotal === 1 ? '' : 's'} in this range`}
                rows={[1, 2, 3, 4, 5]
                  .map((star) => ({
                    star,
                    c2c: data!.ratings.client_to_creator[star - 1],
                    cr2c: data!.ratings.creator_to_client[star - 1],
                  }))
                  .filter((r) => r.c2c > 0 || r.cr2c > 0)
                  .map((r) => ({
                    label: `${r.star}★`,
                    value: (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        {r.c2c > 0 && <Pill tone="brand">{r.c2c} client → creator</Pill>}
                        {r.cr2c > 0 && <Pill tone="neutral">{r.cr2c} creator → client</Pill>}
                      </span>
                    ),
                  }))}
                note={`A distribution over five stars and two directions needs a population. Below ${RATINGS_MIN} ratings this states what came in; the chart returns on its own above that.`}
              />
            ) : (
              <ChartBody isEmpty={false} empty="" height={210}>
                <BarChart data={ratingRows}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="star" {...AXIS} />
                  <YAxis allowDecimals={false} {...AXIS} width={30} />
                  <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--bg)' }} />
                  <Legend {...LEGEND} />
                  <Bar dataKey="client → creator" fill={GOLD} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="creator → client" fill={INK} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBody>
            )}
          </Panel>
        </>
        )}
      </ListState>
    </>
  );
}
