import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Freshness, ListState, Pill, fetchState, formatWhen } from '../components/ui';

/**
 * Waiting age, escalating. A row 4 working days old must not read the same as
 * one from this morning — the list should make staleness obvious BEFORE the
 * stale-application alert fires.
 */
function WaitingAge({ days, parked }: { days: number; parked?: boolean }) {
  const tone = days >= 4 ? 'danger' : days >= 2 ? 'warn' : 'neutral';
  const label = days === 0 ? 'today' : days === 1 ? '1 working day' : `${days} working days`;
  return (
    <>
      <Pill tone={tone}>
        {days >= 4 ? '⚠ ' : ''}
        waiting {label}
      </Pill>
      {parked && <Pill tone="warn">parked — name review</Pill>}
    </>
  );
}

interface CreatorRow {
  waiting_working_days?: number;
  parked_for_name_review?: boolean;
  user_id: string;
  vetting_status: string;
  background_check_status: string;
  verified: boolean;
  is_available: boolean;
  service_type: string;
  specialties: string[];
  base_area: string | null;
  applied_at: string | null;
  created_at: string;
  name: string;
  email: string | null;
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'in_review', label: 'In review' },
  { key: 'approved', label: 'Approved' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'rejected', label: 'Rejected' },
];

export function Creators() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');

  const q = useQuery({
    queryKey: ['creators', status],
    queryFn: () => api<{ creators: CreatorRow[] }>(`/v1/admin/creators${status ? `?status=${status}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  const { state, stale } = fetchState(q);

  const rows = data?.creators ?? [];
  const inReview = rows.filter((c) => c.vetting_status === 'in_review').length;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Creators</h1>
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
      <p className="page-sub">
        Applications queue first{inReview ? ` — ${inReview} waiting for review` : ''}, then the roster.
      </p>

      <div className="list-toolbar">
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${status === f.key ? ' active' : ''}`}
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ListState
        status={state}
        isEmpty={rows.length === 0}
        error={(error as Error | null)?.message}
        onRetry={() => refetch()}
        rows={6}
        empty={
          status === 'in_review' ? (
            'No applications waiting — every creator who applied has had a decision.'
          ) : status === 'suspended' ? (
            'No suspended creators — the whole roster is in good standing.'
          ) : status ? (
            <>
              No {status.replace(/_/g, ' ')} creators.{' '}
              <button className="btn ghost" style={{ marginLeft: 4 }} onClick={() => setStatus('')}>
                Show all creators
              </button>
            </>
          ) : (
            'No creator applications yet.'
          )
        }
      >
        <div className="t-table-card">
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th>Works</th>
                  <th>Base area</th>
                  <th>Applied</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.user_id} className="clickable" onClick={() => navigate(`/creators/${c.user_id}`)}>
                    <td>
                      <div className="cell-title">
                        {c.name || '(no name)'}
                        {c.verified ? ' ✓' : ''}
                      </div>
                    </td>
                    <td>
                      <div>{c.specialties.length ? c.specialties.join(', ') : '—'}</div>
                      <div className="cell-sub">{c.service_type}</div>
                    </td>
                    <td>{c.base_area ?? <span style={{ color: 'var(--muted)' }}>no base area</span>}</td>
                    <td className="nowrap num">
                      {c.applied_at ? formatWhen(c.applied_at) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td className="right">
                      <div className="cell-pills">
                        {!c.is_available && c.vetting_status === 'approved' && <Pill tone="neutral">paused</Pill>}
                        <Pill status={c.vetting_status} />
                        {c.vetting_status === 'in_review' && (
                          <WaitingAge days={c.waiting_working_days ?? 0} parked={c.parked_for_name_review} />
                        )}
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
