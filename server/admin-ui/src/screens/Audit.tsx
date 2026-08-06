import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api';
import { EmptyState, SectionSkeleton, formatWhen } from '../components/ui';

interface AuditEntry {
  id: string;
  admin_id: string;
  admin_name: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export function Audit() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit', debounced],
    queryFn: () => api<{ entries: AuditEntry[] }>(`/v1/admin/audit?q=${encodeURIComponent(debounced)}&limit=100`),
    placeholderData: keepPreviousData,
  });

  const rows = data?.entries ?? [];

  return (
    <>
      <h1 className="page-title">Audit log</h1>
      <p className="page-sub">
        Every consequential admin action — who, what, when. Search matches the action name and target.
      </p>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Search actions… (e.g. payout, suspend, config)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search audit log"
        />
      </div>

      {isLoading ? (
        <SectionSkeleton rows={8} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState glyph="—">{debounced ? `No entries match “${debounced}”.` : 'No admin actions recorded yet.'}</EmptyState>
      ) : (
        <div className="card row-list">
          {rows.map((a) => (
            <div key={a.id} className="row">
              <div className="who grow">
                <div className="name">{a.action.replace(/_/g, ' ')}</div>
                <div className="sub num">
                  {a.admin_name ?? 'admin'} · {formatWhen(a.created_at)}
                  {a.target ? ` · ${a.target}` : ''}
                  {a.detail && Object.keys(a.detail).length > 0
                    ? ` · ${Object.entries(a.detail)
                        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                        .join(' · ')}`
                    : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
