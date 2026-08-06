import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';

interface Report {
  id: string;
  reporter_id: string;
  target_user_id: string | null;
  booking_id: string | null;
  category: string;
  severity: string;
  details: string | null;
  status: string;
  law_enforcement_referral: boolean;
  created_at: string;
  reporter_false_report_count: number;
  reporter_name: string | null;
  target_name: string | null;
}

interface PortfolioItem {
  id: string;
  creator_id: string;
  caption: string | null;
  created_at: string;
  creator_name: string | null;
}

const SEVERITY_TONE: Record<string, 'danger' | 'warn' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

export function Moderation() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [selReports, setSelReports] = useState<Set<string>>(new Set());
  const [selPortfolio, setSelPortfolio] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['moderation'],
    queryFn: () =>
      api<{ reports: Report[]; portfolio_pending: PortfolioItem[] }>('/v1/admin/moderation'),
    refetchInterval: 60_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['moderation'] });
  const review = useMutation({
    mutationFn: (vars: { id: string; action: 'actioned' | 'dismissed' }) =>
      api(`/v1/admin/reports/${vars.id}`, { method: 'POST', body: JSON.stringify({ action: vars.action }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const portfolio = useMutation({
    mutationFn: (vars: { id: string; decision: 'approved' | 'rejected' }) =>
      api(`/v1/admin/portfolio/${vars.id}`, { method: 'POST', body: JSON.stringify({ decision: vars.decision }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const bulkReports = useMutation({
    mutationFn: async (action: 'actioned' | 'dismissed') => {
      await Promise.all(
        [...selReports].map((id) => api(`/v1/admin/reports/${id}`, { method: 'POST', body: JSON.stringify({ action }) })),
      );
    },
    onSuccess: () => {
      setActionError(null);
      setSelReports(new Set());
    },
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const bulkPortfolio = useMutation({
    mutationFn: async (decision: 'approved' | 'rejected') => {
      await Promise.all(
        [...selPortfolio].map((id) => api(`/v1/admin/portfolio/${id}`, { method: 'POST', body: JSON.stringify({ decision }) })),
      );
    },
    onSuccess: () => {
      setActionError(null);
      setSelPortfolio(new Set());
    },
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });

  return (
    <>
      <h1 className="page-title">Moderation</h1>
      <p className="page-sub">
        Reports sort by severity — critical and high arrive here already auto-actioned (content
        held, account suspended) and need human review; reversing a bad one is done from the user's
        record (Unsuspend), which also counts the false report.
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      <div className="section">
        <h2>
          Reports <span className="count num">{data?.reports.length || ''}</span>
        </h2>
        {(data?.reports.length ?? 0) > 1 && (
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button
              className="chip"
              onClick={() =>
                setSelReports(
                  selReports.size === data!.reports.length ? new Set() : new Set(data!.reports.map((r) => r.id)),
                )
              }
            >
              {selReports.size === data!.reports.length ? 'Clear selection' : 'Select all'}
            </button>
            {selReports.size > 0 && (
              <>
                <button
                  className="btn"
                  disabled={bulkReports.isPending}
                  onClick={() => {
                    if (window.confirm(`Mark ${selReports.size} report${selReports.size === 1 ? '' : 's'} ACTIONED?`))
                      bulkReports.mutate('actioned');
                  }}
                >
                  Action {selReports.size}
                </button>
                <button
                  className="btn ghost"
                  disabled={bulkReports.isPending}
                  onClick={() => {
                    if (window.confirm(`Dismiss ${selReports.size} report${selReports.size === 1 ? '' : 's'}?`))
                      bulkReports.mutate('dismissed');
                  }}
                >
                  Dismiss {selReports.size}
                </button>
              </>
            )}
          </div>
        )}
        {isLoading ? (
          <SectionSkeleton rows={4} />
        ) : isError ? (
          <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
        ) : (data?.reports ?? []).length === 0 ? (
          <EmptyState glyph="✓">No open reports.</EmptyState>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {data!.reports.map((r) => (
              <div key={r.id} className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    checked={selReports.has(r.id)}
                    onChange={() => toggle(selReports, r.id, setSelReports)}
                    aria-label="Select report"
                  />
                  <Pill tone={SEVERITY_TONE[r.severity] ?? 'neutral'}>{r.severity}</Pill>
                  <span style={{ fontWeight: 700 }}>{r.category.replace(/_/g, ' ')}</span>
                  {r.law_enforcement_referral && <Pill tone="danger">LE referral</Pill>}
                  <span className="sub" style={{ color: 'var(--muted)', fontSize: 12 }}>{formatWhen(r.created_at)}</span>
                </div>
                <div className="sub" style={{ fontSize: 13 }}>
                  {r.reporter_name ?? 'user'} reported{' '}
                  {r.target_user_id ? (
                    <Link to={`/users/${r.target_user_id}`}>{r.target_name ?? 'user'}</Link>
                  ) : (
                    'content'
                  )}
                  {r.booking_id ? (
                    <>
                      {' '}
                      on <Link to={`/bookings/${r.booking_id}`}>booking {r.booking_id.slice(0, 8)}</Link>
                    </>
                  ) : null}
                  {r.reporter_false_report_count > 0 && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--warn)' }}>
                        reporter has {r.reporter_false_report_count} false report
                        {r.reporter_false_report_count === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </div>
                {r.details && <div style={{ fontSize: 13 }}>{r.details}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn"
                    disabled={review.isPending}
                    onClick={() => {
                      if (window.confirm('Mark ACTIONED — the report was valid and its consequences stand?'))
                        review.mutate({ id: r.id, action: 'actioned' });
                    }}
                  >
                    Actioned
                  </button>
                  <button
                    className="btn ghost"
                    disabled={review.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'DISMISS this report? If it caused a suspension, also lift it from the user\'s record — that step counts the false report.',
                        )
                      )
                        review.mutate({ id: r.id, action: 'dismissed' });
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>
          Portfolio queue <span className="count num">{data?.portfolio_pending.length || ''}</span>
        </h2>
        {(data?.portfolio_pending.length ?? 0) > 1 && (
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button
              className="chip"
              onClick={() =>
                setSelPortfolio(
                  selPortfolio.size === data!.portfolio_pending.length
                    ? new Set()
                    : new Set(data!.portfolio_pending.map((p) => p.id)),
                )
              }
            >
              {selPortfolio.size === data!.portfolio_pending.length ? 'Clear selection' : 'Select all'}
            </button>
            {selPortfolio.size > 0 && (
              <>
                <button
                  className="btn"
                  disabled={bulkPortfolio.isPending}
                  onClick={() => {
                    if (window.confirm(`Approve ${selPortfolio.size} portfolio item${selPortfolio.size === 1 ? '' : 's'}?`))
                      bulkPortfolio.mutate('approved');
                  }}
                >
                  Approve {selPortfolio.size}
                </button>
                <button
                  className="btn ghost"
                  disabled={bulkPortfolio.isPending}
                  onClick={() => {
                    if (window.confirm(`Reject ${selPortfolio.size} portfolio item${selPortfolio.size === 1 ? '' : 's'}?`))
                      bulkPortfolio.mutate('rejected');
                  }}
                >
                  Reject {selPortfolio.size}
                </button>
              </>
            )}
          </div>
        )}
        {isLoading ? (
          <SectionSkeleton rows={2} />
        ) : (data?.portfolio_pending ?? []).length === 0 ? (
          <EmptyState glyph="✓">Nothing waiting for portfolio review.</EmptyState>
        ) : (
          <div className="card row-list">
            {data!.portfolio_pending.map((p) => (
              <div key={p.id} className="row">
                <input
                  type="checkbox"
                  checked={selPortfolio.has(p.id)}
                  onChange={() => toggle(selPortfolio, p.id, setSelPortfolio)}
                  aria-label="Select portfolio item"
                />
                <div className="who grow">
                  <div className="name">
                    {p.creator_name ?? 'creator'} · {p.caption || '(no caption)'}
                  </div>
                  <div className="sub">{formatWhen(p.created_at)}</div>
                </div>
                <button
                  className="btn"
                  disabled={portfolio.isPending}
                  onClick={() => portfolio.mutate({ id: p.id, decision: 'approved' })}
                >
                  Approve
                </button>
                <button
                  className="btn ghost"
                  disabled={portfolio.isPending}
                  onClick={() => portfolio.mutate({ id: p.id, decision: 'rejected' })}
                >
                  Reject
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
