import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api';
import { Freshness, ListState, fetchState, formatWhen } from '../components/ui';

interface AuditEntry {
  id: string;
  admin_id: string;
  admin_name: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

/**
 * Detail as chips rather than one stringified line.
 *
 * The old row concatenated every key into the sub-line, so a config write
 * (the longest on production is 386 characters) wrapped to four lines and
 * broke the rhythm of the hundred rows around it. Nothing is truncated here:
 * most entries carry no detail at all, so the table stays even, and the few
 * that say more are taller because they genuinely say more.
 */
function Detail({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail ?? {});
  if (entries.length === 0) return <span style={{ color: 'var(--faint)' }}>—</span>;
  return (
    <div className="kvchips">
      {entries.map(([k, v]) => (
        <span className="kvchip" key={k}>
          <b>{k.replace(/_/g, ' ')}</b>
          <span>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</span>
        </span>
      ))}
    </div>
  );
}

export function Audit() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const q = useQuery({
    queryKey: ['audit', debounced],
    queryFn: () => api<{ entries: AuditEntry[] }>(`/v1/admin/audit?q=${encodeURIComponent(debounced)}&limit=100`),
    placeholderData: keepPreviousData,
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  const { state, stale } = fetchState(q);

  const rows = data?.entries ?? [];

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Audit log</h1>
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
      <p className="page-sub">
        Every consequential admin action — who, what, when. Search matches the action name and target.
      </p>

      <div className="list-toolbar">
        <input
          className="input"
          placeholder="Search actions… (e.g. payout, suspend, config)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search audit log"
        />
      </div>

      <ListState
        status={state}
        isEmpty={rows.length === 0}
        error={(error as Error | null)?.message}
        onRetry={() => refetch()}
        rows={8}
        empty={
          debounced ? (
            <>
              No entries match “{debounced}”.{' '}
              <button className="btn ghost" style={{ marginLeft: 4 }} onClick={() => setTerm('')}>
                Clear search
              </button>
            </>
          ) : (
            'No admin actions recorded yet.'
          )
        }
      >
        <div className="t-table-card">
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Admin</th>
                  <th>When</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">
                      <span className="cell-title">{a.action.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="nowrap">{a.admin_name ?? 'admin'}</td>
                    <td className="nowrap num">{formatWhen(a.created_at)}</td>
                    {/* Targets are full UUIDs. Wrapped, they put almost every
                        row on two lines; the card scrolls sideways instead so
                        the id stays whole and the rows stay even. */}
                    <td className="num nowrap" style={{ color: 'var(--muted)' }}>
                      {a.target ?? '—'}
                    </td>
                    <td>
                      <Detail detail={a.detail} />
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
