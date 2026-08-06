import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatMoney, formatWhen } from '../components/ui';

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
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bookings', filter],
    queryFn: () => api<{ bookings: BookingRow[] }>(`/v1/admin/bookings${qs}`),
    placeholderData: keepPreviousData,
    refetchInterval: filter === 'unassigned' ? 30_000 : false,
  });

  const rows = data?.bookings ?? [];

  return (
    <>
      <h1 className="page-title">Bookings</h1>
      <p className="page-sub">
        The full ledger. Unassigned is the manual-dispatch queue — open one to assign a creator.
      </p>

      <div className="toolbar">
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <SectionSkeleton rows={6} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState glyph={filter === 'unassigned' ? '✓' : '—'}>
          {filter === 'unassigned' ? 'Nothing waiting for dispatch.' : 'No bookings here.'}
        </EmptyState>
      ) : (
        <div className="card row-list">
          {rows.map((b) => (
            <div key={b.id} className="row row-link" onClick={() => navigate(`/bookings/${b.id}`)}>
              <div className="who grow">
                <div className="name">
                  {b.occasion ?? b.type} · {b.client_name ?? 'client'}
                  {b.creator_name ? ` → ${b.creator_name}` : ''}
                </div>
                <div className="sub">
                  {b.id.slice(0, 8)} · {b.area ?? (b.type === 'remote' ? 'remote' : '—')}
                  {b.scheduled_at ? ` · ${formatWhen(b.scheduled_at)}` : ' · not scheduled'} ·{' '}
                  {formatMoney(Number(b.price_usd))}
                </div>
              </div>
              {b.legal_hold && <Pill tone="danger">legal hold</Pill>}
              {!b.creator_name && b.status === 'pending' && <Pill tone="warn">needs dispatch</Pill>}
              <Pill status={b.status} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
