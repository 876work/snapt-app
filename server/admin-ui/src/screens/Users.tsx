import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mode: string;
  created_at: string;
  suspended_at: string | null;
  false_report_count: number;
  creator: { vetting_status: string; verified: boolean } | null;
}

type Filter = 'all' | 'suspended' | 'creators';

export function Users() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['users', debounced],
    queryFn: () => api<{ users: UserRow[] }>(`/v1/admin/users?q=${encodeURIComponent(debounced)}&limit=50`),
    placeholderData: keepPreviousData,
  });

  const rows = (data?.users ?? []).filter((u) =>
    filter === 'suspended' ? u.suspended_at : filter === 'creators' ? u.creator : true,
  );

  return (
    <>
      <h1 className="page-title">Users</h1>
      <p className="page-sub">
        Every account — clients and creators. Search covers name, email, and phone.
      </p>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Search name, email, phone…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search users"
        />
        <div className="chip-row">
          {(['all', 'suspended', 'creators'] as Filter[]).map((f) => (
            <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'suspended' ? 'Suspended' : 'Creators'}
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
          {debounced ? `No users match “${debounced}”.` : 'No users yet.'}
        </EmptyState>
      ) : (
        <div className="card row-list">
          {rows.map((u) => (
            <div key={u.id} className="row row-link" onClick={() => navigate(`/users/${u.id}`)}>
              <div className="who grow">
                <div className="name">{u.full_name || '(no name)'}</div>
                <div className="sub">
                  {u.email ?? '—'} · {u.phone ?? 'no phone'} · joined {formatWhen(u.created_at)}
                </div>
              </div>
              {u.false_report_count > 0 && <Pill tone="warn">{u.false_report_count} false report{u.false_report_count === 1 ? '' : 's'}</Pill>}
              {u.creator && <Pill status={u.creator.vetting_status} />}
              {u.suspended_at ? <Pill status="suspended" /> : <Pill tone="neutral">{u.mode}</Pill>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
