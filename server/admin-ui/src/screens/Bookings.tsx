import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadFile } from '../api';
import { SavedViews } from '../components/SavedViews';
import {
  Freshness,
  ListState,
  Pill,
  fetchState,
  formatMoney,
  formatWhen,
} from '../components/ui';

interface BookingRow {
  id: string;
  status: string;
  occasion: string | null;
  type: string;
  area: string | null;
  scheduled_at: string | null;
  price_usd: number;
  legal_hold: boolean | null;
  created_at: string;
  client_name: string | null;
  creator_name: string | null;
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'completed', label: 'Completed' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function Bookings() {
  const navigate = useNavigate();
  // Today's "unassigned bookings" tile lands here pre-filtered.
  const [params, setParams] = useSearchParams();
  const [filter, setFilterState] = useState(params.get('filter') ?? '');
  const setFilter = (f: string) => {
    setFilterState(f);
    setParams(f ? { filter: f } : {}, { replace: true });
  };

  const qs = filter === 'unassigned' ? '?unassigned=true' : filter ? `?status=${filter}` : '';
  const q = useQuery({
    queryKey: ['bookings', filter],
    queryFn: () => api<{ bookings: BookingRow[] }>(`/v1/admin/bookings${qs}`),
    placeholderData: keepPreviousData,
    refetchInterval: filter === 'unassigned' ? 30_000 : false,
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  const { state, stale } = fetchState(q);

  const rows = data?.bookings ?? [];
  const label = FILTERS.find((f) => f.key === filter)?.label ?? filter;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Bookings</h1>
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
      <p className="page-sub">
        The full ledger. Unassigned is the manual-dispatch queue — open one to assign a creator.
      </p>

      <div className="list-toolbar">
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <SavedViews screen="bookings" current={filter} onApply={setFilter} />
        <button
          className="btn ghost"
          onClick={() =>
            downloadFile('/v1/admin/export/bookings', 'snapt-bookings-all.csv').catch((e) =>
              window.alert((e as Error).message),
            )
          }
        >
          Export CSV
        </button>
      </div>

      <ListState
        status={state}
        isEmpty={rows.length === 0}
        error={(error as Error | null)?.message}
        onRetry={() => refetch()}
        rows={6}
        empty={
          filter === 'unassigned' ? (
            'Nothing waiting for dispatch — every booking has a creator on it.'
          ) : filter ? (
            <>
              No {label.toLowerCase()} bookings right now.{' '}
              <button className="btn ghost" style={{ marginLeft: 4 }} onClick={() => setFilter('')}>
                Show all bookings
              </button>
            </>
          ) : (
            'No bookings yet. Every booking ever made shows here, whatever its state.'
          )
        }
      >
        <div className="t-table-card">
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Where</th>
                  <th>Scheduled</th>
                  <th className="right">Price</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => navigate(`/bookings/${b.id}`)}>
                    <td>
                      <div className="cell-title">
                        {b.occasion ?? b.type} · {b.client_name ?? 'client'}
                        {b.creator_name ? ` → ${b.creator_name}` : ''}
                      </div>
                      <div className="cell-sub num">{b.id.slice(0, 8)}</div>
                    </td>
                    <td>{b.area ?? (b.type === 'remote' ? 'remote' : '—')}</td>
                    <td className="nowrap num">
                      {b.scheduled_at ? (
                        formatWhen(b.scheduled_at)
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>not scheduled</span>
                      )}
                    </td>
                    <td className="right nowrap num">{formatMoney(Number(b.price_usd))}</td>
                    <td className="right">
                      <div className="cell-pills">
                        {b.legal_hold && <Pill tone="danger">legal hold</Pill>}
                        {!b.creator_name && b.status === 'pending' && <Pill tone="warn">needs dispatch</Pill>}
                        <Pill status={b.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ListState>
    </>
  );
}
