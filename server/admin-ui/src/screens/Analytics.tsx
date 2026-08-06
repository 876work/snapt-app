import { useState } from 'react';
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
import { EmptyState, SectionSkeleton, formatMoney } from '../components/ui';

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
const BLUE = '#2F5FB3';
const RED = '#C23434';
const GRID = '#EFEDE7';

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

function Chart({
  title,
  empty,
  isEmpty,
  height = 240,
  children,
}: {
  title: string;
  empty: string;
  isEmpty: boolean;
  height?: number;
  children: React.ReactElement;
}) {
  return (
    <div className="section">
      <h2>{title}</h2>
      {isEmpty ? (
        <EmptyState glyph="—">{empty}</EmptyState>
      ) : (
        <div className="card" style={{ padding: '18px 12px 8px 0' }}>
          <ResponsiveContainer width="100%" height={height}>
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function Analytics() {
  const [preset, setPreset] = useState<string>('30');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const range = custom ?? rangeFor(preset);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analytics-series', range.from, range.to],
    queryFn: () => api<SeriesData>(`/v1/admin/analytics/series?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });

  const [exportErr, setExportErr] = useState<string | null>(null);

  if (isError) {
    return (
      <>
        <h1 className="page-title">Analytics</h1>
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      </>
    );
  }

  const totals = data
    ? {
        bookings: data.bookings.reduce((s, r) => s + r.in_person + r.remote, 0),
        charged: Math.round(data.revenue.reduce((s, r) => s + r.charged, 0) * 100) / 100,
        fees: Math.round(data.revenue.reduce((s, r) => s + r.fees, 0) * 100) / 100,
        cancels: data.cancellations.gt48h + data.cancellations.h24_48 + data.cancellations.lt24h + data.cancellations.unscheduled,
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

  const ratingsEmpty = !data || [...data.ratings.client_to_creator, ...data.ratings.creator_to_client].every((v) => v === 0);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Analytics</h1>
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
      {exportErr && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {exportErr}
        </div>
      )}

      {isLoading || !data ? (
        <SectionSkeleton rows={8} />
      ) : (
        <>
          <Chart
            title="Bookings over time"
            empty="No bookings in this range yet — they'll chart here as they come in."
            isEmpty={totals!.bookings === 0}
          >
            <BarChart data={data.bookings.map((r) => ({ ...r, label: day(r.date) }))}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={18} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={30} />
              <Tooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="in_person" name="in person" stackId="b" fill={GOLD} radius={[0, 0, 0, 0]} />
              <Bar dataKey="remote" name="remote" stackId="b" fill={INK} radius={[3, 3, 0, 0]} />
            </BarChart>
          </Chart>

          <Chart
            title="Revenue over time"
            empty="No money moved in this range yet. Charges and platform fees will chart here."
            isEmpty={totals!.charged === 0 && totals!.fees === 0}
          >
            <ComposedChart data={data.revenue.map((r) => ({ ...r, label: day(r.date) }))}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={18} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={46} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="charged" name="charged (net of refunds)" fill="rgba(255,184,0,0.25)" stroke={GOLD} strokeWidth={2} />
              <Line dataKey="fees" name="platform fee revenue" stroke={INK} strokeWidth={2} dot={false} />
            </ComposedChart>
          </Chart>

          <Chart
            title="Cancellations by notice"
            empty="No cancellations in this range — nothing leaking."
            isEmpty={totals!.cancels === 0}
            height={190}
          >
            <BarChart data={cancelRows} layout="vertical">
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
              <YAxis type="category" dataKey="tier" tickLine={false} axisLine={false} fontSize={12} width={96} />
              <Tooltip />
              <Bar dataKey="count" name="cancellations" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </Chart>

          <Chart
            title={`Creator utilisation · ${data.active_creators} active creator${data.active_creators === 1 ? '' : 's'}`}
            empty="No completed jobs in this range yet. Once sessions complete, jobs-per-creator shows here."
            isEmpty={data.utilisation.every((u) => u.jobs === 0)}
            height={Math.max(160, data.utilisation.length * 34)}
          >
            <BarChart data={data.utilisation} layout="vertical">
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
              <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={12} width={120} />
              <Tooltip />
              <Bar dataKey="jobs" name="completed jobs" fill={GOLD} radius={[0, 4, 4, 0]} />
            </BarChart>
          </Chart>

          <Chart
            title="Bookings by area"
            empty="No bookings in this range — area distribution appears once there are bookings."
            isEmpty={data.areas.length === 0}
            height={Math.max(160, data.areas.length * 32)}
          >
            <BarChart data={data.areas} layout="vertical">
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
              <YAxis type="category" dataKey="area" tickLine={false} axisLine={false} fontSize={12} width={120} />
              <Tooltip />
              <Bar dataKey="count" name="bookings" fill={BLUE} radius={[0, 4, 4, 0]} />
            </BarChart>
          </Chart>

          <Chart
            title="Rating distribution"
            empty="No reviews in this range yet. Both directions chart here once ratings land."
            isEmpty={ratingsEmpty}
            height={210}
          >
            <BarChart data={ratingRows}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="star" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={30} />
              <Tooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="client → creator" fill={GOLD} radius={[3, 3, 0, 0]} />
              <Bar dataKey="creator → client" fill={INK} radius={[3, 3, 0, 0]} />
            </BarChart>
          </Chart>
        </>
      )}
    </>
  );
}
