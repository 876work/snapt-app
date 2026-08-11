import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api';
import { useAuth } from '../auth';
import { Freshness, ListState, fetchState, formatMoney } from '../components/ui';
import { PayoutMethodSwitches } from '../components/PayoutMethodSwitches';

interface PayoutRequest {
  creator_id: string;
  total: number;
  ids: string[];
  name: string | null;
  email: string | null;
  phone: string | null;
  method: string | null;
  admin_note: string | null;
  payout_details: string | null;
  payout_name_check: {
    state: 'ok' | 'minor' | 'mismatch' | 'unverified';
    holder_name: string;
    legal_name: string | null;
    reasons?: string[];
    note?: string;
  } | null;
}

export function Payouts() {
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['payouts'],
    queryFn: () => api<{ requests: PayoutRequest[] }>('/v1/admin/payout-requests'),
    refetchInterval: 60_000,
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  const { state, stale } = fetchState(q);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['payouts'] });
  const note = useMutation({
    mutationFn: (vars: { creator_id: string; note: string }) =>
      api('/v1/admin/payout-requests/note', { method: 'POST', body: JSON.stringify(vars) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const fulfill = useMutation({
    mutationFn: (creator_id: string) =>
      api('/v1/admin/payout-requests/fulfill', { method: 'POST', body: JSON.stringify({ creator_id }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const resendNotification = useMutation({
    mutationFn: (user_id: string) =>
      api('/v1/admin/resend-email', { method: 'POST', body: JSON.stringify({ kind: 'payout_notification', user_id }) }),
    onSuccess: () => {
      setActionError(null);
      setSentFlash('Payout notification re-sent.');
    },
    onError: (e) => setActionError((e as Error).message),
  });

  const total = (data?.requests ?? []).reduce((s, r) => s + r.total, 0);
  const isAdmin = identity?.role === 'admin';

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Payouts</h1>
        <button
          className="btn ghost"
          onClick={() =>
            downloadFile('/v1/admin/export/payouts', 'snapt-payouts-all.csv').catch((e) =>
              setActionError((e as Error).message),
            )
          }
        >
          Export CSV
        </button>
        {data && data.requests.length > 0 && (
          <span className="page-sub num" style={{ margin: 0 }}>
            {formatMoney(total)} across {data.requests.length} creator
            {data.requests.length === 1 ? '' : 's'}
          </span>
        )}
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
      <p className="page-sub">
        Manual fulfilment: send the money externally (bank transfer, or arrange cash pickup by phone),
        then mark paid — the creator is notified and everything is audited.
        {!isAdmin && ' Marking paid needs the admin role.'}
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}
      {sentFlash && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--ok)', marginBottom: 12 }}>
          {sentFlash}
        </div>
      )}

      {/* Availability sits above the queue on purpose: when a bank is down,
          turning it off is the first thing you come here to do. */}
      <PayoutMethodSwitches canEdit={isAdmin} />

      <div style={{ marginTop: 16 }}>
      <ListState
        status={state}
        isEmpty={(data?.requests ?? []).length === 0}
        error={(error as Error | null)?.message}
        onRetry={() => refetch()}
        rows={3}
        empty="Nobody is waiting to be paid. Requests appear here the moment a creator cashes out."
      >
        <div style={{ display: 'grid', gap: 'var(--gap-grid)' }}>
          {(data?.requests ?? []).map((r) => (
            <div key={r.creator_id} className="t-card" style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div className="grow" style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700 }}>
                    <Link to={`/creators/${r.creator_id}`}>{r.name ?? 'creator'}</Link> ·{' '}
                    <span className="num">{formatMoney(r.total)}</span>
                  </div>
                  <div className="sub" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    {r.email ?? '—'} · {r.phone ?? 'no phone'} · {r.ids.length} payout{r.ids.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  className="btn ghost"
                  disabled={note.isPending}
                  onClick={() => {
                    const text = window.prompt('Note on this request (e.g. “Arranged Thurs 2pm, ID confirmed”):', r.admin_note ?? '');
                    if (text?.trim()) note.mutate({ creator_id: r.creator_id, note: text.trim() });
                  }}
                >
                  {r.admin_note ? 'Edit note' : 'Add note'}
                </button>
                <button
                  className="btn ghost"
                  disabled={resendNotification.isPending}
                  title="Re-send the last 'payout sent' email to this creator"
                  onClick={() => {
                    if (window.confirm('Re-send the most recent payout notification email to this creator?'))
                      resendNotification.mutate(r.creator_id);
                  }}
                >
                  ✉ Resend
                </button>
                {isAdmin && (
                  <button
                    className="btn"
                    disabled={fulfill.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Mark ${formatMoney(r.total)} to ${r.name ?? 'this creator'} as PAID?\n\nOnly do this after the money has actually been sent. The creator is notified immediately.`,
                        )
                      )
                        fulfill.mutate(r.creator_id);
                    }}
                  >
                    Mark paid
                  </button>
                )}
              </div>
              <div className="sub" style={{ fontSize: 13 }}>
                {r.payout_details ?? 'No payout method on file — contact the creator.'}
              </div>
              {/* §6 Payout name check — surfaced, never blocking. A joint or
                  business account is legitimate; this is a prompt to ask, not
                  a reason to withhold someone's money. */}
              {r.payout_name_check && r.payout_name_check.state !== 'ok' && (
                <div
                  className="sub"
                  style={{
                    fontSize: 12.5,
                    marginTop: 6,
                    padding: '7px 10px',
                    borderRadius: 8,
                    borderLeft: `3px solid ${
                      r.payout_name_check.state === 'mismatch' ? 'var(--danger)' : 'var(--warn)'
                    }`,
                    background: 'var(--bg)',
                  }}
                >
                  {r.payout_name_check.state === 'unverified' ? (
                    <>Account name “{r.payout_name_check.holder_name}” — no verified legal name to check it against yet.</>
                  ) : r.payout_name_check.state === 'mismatch' ? (
                    <>
                      <strong>Payout name doesn't match.</strong> Money is going to “
                      {r.payout_name_check.holder_name}”, but the verified legal name is “
                      {r.payout_name_check.legal_name}”. Confirm before paying.
                    </>
                  ) : (
                    <>
                      Payout name “{r.payout_name_check.holder_name}” differs slightly from “
                      {r.payout_name_check.legal_name}”
                      {r.payout_name_check.reasons?.length
                        ? ` (${r.payout_name_check.reasons.join(', ')})`
                        : ''}
                      .
                    </>
                  )}
                </div>
              )}
              {r.admin_note && (
                <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)' }}>Note: {r.admin_note}</div>
              )}
            </div>
          ))}
        </div>
      </ListState>
      </div>
    </>
  );
}
