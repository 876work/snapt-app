import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';

interface CreatorRow {
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

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['creators', status],
    queryFn: () => api<{ creators: CreatorRow[] }>(`/v1/admin/creators${status ? `?status=${status}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const rows = data?.creators ?? [];
  const inReview = rows.filter((c) => c.vetting_status === 'in_review').length;

  return (
    <>
      <h1 className="page-title">Creators</h1>
      <p className="page-sub">
        Applications queue first{inReview ? ` — ${inReview} waiting for review` : ''}, then the roster.
      </p>

      <div className="toolbar">
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

      {isLoading ? (
        <SectionSkeleton rows={6} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState glyph="—">
          {status ? `No ${status.replace(/_/g, ' ')} creators.` : 'No creator applications yet.'}
        </EmptyState>
      ) : (
        <div className="card row-list">
          {rows.map((c) => (
            <div key={c.user_id} className="row row-link" onClick={() => navigate(`/creators/${c.user_id}`)}>
              <div className="who grow">
                <div className="name">
                  {c.name || '(no name)'}
                  {c.verified ? ' ✓' : ''}
                </div>
                <div className="sub">
                  {c.specialties.join(', ')} · {c.service_type} · {c.base_area ?? 'no base area'}
                  {c.applied_at ? ` · applied ${formatWhen(c.applied_at)}` : ''}
                </div>
              </div>
              {!c.is_available && c.vetting_status === 'approved' && <Pill tone="neutral">paused</Pill>}
              <Pill status={c.vetting_status} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
