import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Freshness, ListState, Pill, fetchState, formatWhen } from '../components/ui';

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
  /** Present only on category 'revision_scope' — the request being flagged. */
  revision_request: { details: string; created_at: string; is_free: boolean } | null;
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

  const q = useQuery({
    queryKey: ['moderation'],
    queryFn: () =>
      api<{ reports: Report[]; portfolio_pending: PortfolioItem[] }>('/v1/admin/moderation'),
    refetchInterval: 60_000,
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  // Both queues come from ONE request, so they share one state. That is
  // exactly why the portfolio queue must not draw its own conclusion from
  // `length === 0`: when this request fails there is no portfolio queue to
  // be empty, and a green tick there while Reports shows an error was the
  // portal telling two different stories about the same failure.
  const { state, stale } = fetchState(q);
  const errorText = (error as Error | null)?.message;
  const counted = (n: number | undefined) => (state === 'success' && n !== undefined ? n : '');

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
      <div className="page-head">
        <h1 className="page-title">Moderation</h1>
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
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
          Reports <span className="count num">{counted(data?.reports.length)}</span>
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
        <ListState
          status={state}
          isEmpty={(data?.reports ?? []).length === 0}
          error={errorText}
          onRetry={() => refetch()}
          rows={3}
          empty="No open reports — nothing is waiting on a moderation decision."
        >
          <div style={{ display: 'grid', gap: 'var(--gap-grid)' }}>
            {(data?.reports ?? []).map((r) => (
              <div key={r.id} className="t-card" style={{ display: 'grid', gap: 8 }}>
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
                  {/* A scope flag has no target by design — the client is
                      never the subject of it and must never be actioned by
                      it — so it reads as the creator flagging a request. */}
                  {r.reporter_name ?? 'user'}{' '}
                  {r.category === 'revision_scope' ? 'flagged a revision request' : 'reported'}
                  {r.category === 'revision_scope' ? null : (
                    <>
                      {' '}
                      {r.target_user_id ? (
                        <Link to={`/users/${r.target_user_id}`}>{r.target_name ?? 'user'}</Link>
                      ) : (
                        'content'
                      )}
                    </>
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
                {/* The client's actual words, beside the creator's
                    explanation — a flag reading "this is beyond the order" is
                    unreadable without the request it is about. */}
                {r.revision_request && (
                  <div
                    style={{
                      fontSize: 13,
                      background: 'var(--bg-subtle, #F7F5F0)',
                      borderLeft: '3px solid var(--border, #E0DCD2)',
                      padding: '8px 10px',
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>
                      Client's request · {formatWhen(r.revision_request.created_at)} ·{' '}
                      {r.revision_request.is_free ? 'included round' : 'paid round'}
                    </div>
                    <div style={{ marginTop: 3 }}>{r.revision_request.details}</div>
                  </div>
                )}
                {r.details && (
                  <div style={{ fontSize: 13 }}>
                    {r.revision_request ? (
                      <>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>
                          Creator says:
                        </span>{' '}
                      </>
                    ) : null}
                    {r.details}
                  </div>
                )}
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
        </ListState>
      </div>

      <div className="section">
        <h2>
          Portfolio queue <span className="count num">{counted(data?.portfolio_pending.length)}</span>
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
        {/* This branch used to be loading → empty, with no failure case at
            all: a failed fetch rendered "✓ Nothing waiting for portfolio
            review" while Reports, from the SAME request, showed an error. */}
        <ListState
          status={state}
          isEmpty={(data?.portfolio_pending ?? []).length === 0}
          error={errorText}
          onRetry={() => refetch()}
          rows={2}
          empty="Nothing waiting for portfolio review — every submitted item has been decided."
        >
          <div className="t-table-card row-list">
            {(data?.portfolio_pending ?? []).map((p) => (
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
        </ListState>
      </div>
    </>
  );
}
