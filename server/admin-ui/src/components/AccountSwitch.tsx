import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { formatMoney, formatWhen } from './ui';

/**
 * Active / Disabled — the hard off switch.
 *
 * Not suspension. A disabled user cannot log in, cannot use the app, and
 * receives nothing. Fully reversible.
 *
 * Turning OFF is deliberately heavy: it loads that user's real commitments
 * first and shows them, because the consequences (a client mid-shoot, paid
 * future bookings, money owed) are exactly what an admin cannot see from a
 * user row. Turning ON is light but still states plainly what does NOT come
 * back, so nobody expects a reassigned booking to return on its own.
 */
interface Commitments {
  active_session: {
    booking_id: string;
    client_name: string;
    scheduled_at: string;
    started: boolean;
    creator_payout_usd: number;
  } | null;
  future_bookings: { booking_id: string; scheduled_at: string; client_name: string }[];
  pending_payouts: { count: number; total_usd: number };
}

interface RestoreSummary {
  bookings_unassigned: number;
  bookings_reassigned: number;
  payouts_moved_usd: number;
  pending_payouts: { count: number; total_usd: number };
}

export function AccountSwitch({
  userId,
  status,
  compact,
}: {
  userId: string;
  status: 'active' | 'disabled';
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<null | 'disable' | 'restore'>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);

  // Only loaded when the dialog opens — a list of 200 users must not fire
  // 200 commitment queries.
  const commitments = useQuery({
    queryKey: ['commitments', userId],
    queryFn: () => api<Commitments>(`/v1/admin/users/${userId}/commitments`),
    enabled: open === 'disable',
  });

  const disable = useMutation({
    mutationFn: (body: { reason: string; force?: boolean }) =>
      api(`/v1/admin/users/${userId}/disable`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setOpen(null);
      setReason('');
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const restore = useMutation({
    mutationFn: (body: { reason: string }) =>
      api<{ summary: RestoreSummary }>(`/v1/admin/users/${userId}/restore`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (r) => {
      // Show what happened while they were off rather than making the admin
      // dig through the audit log for it.
      setSummary(r?.summary ?? null);
      setReason('');
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const c = commitments.data;
  const blocking = c?.active_session ?? null;

  return (
    <>
      <button
        className={status === 'disabled' ? 'btn-ghost' : 'btn-ghost danger'}
        onClick={(e) => {
          e.stopPropagation(); // rows are click-to-navigate
          setError(null);
          setSummary(null);
          setOpen(status === 'disabled' ? 'restore' : 'disable');
        }}
      >
        {status === 'disabled' ? 'Restore access' : compact ? 'Disable' : 'Disable account'}
      </button>

      {open === 'disable' && (
        <Dialog onClose={() => setOpen(null)} title="Disable this account?">
          <p className="dialog-lead">
            They will be signed out and unable to log in. They will receive no push
            notifications, no emails, and nothing in their inbox — nothing queues up while
            they are off. This is fully reversible.
          </p>

          {commitments.isLoading ? (
            <p className="dialog-note">Checking their commitments…</p>
          ) : commitments.isError ? (
            <p className="dialog-warn">
              Couldn't load their commitments. Disabling now could strand work in progress —
              close this and try again.
            </p>
          ) : (
            <div className="dialog-facts">
              {blocking && (
                <div className="dialog-warn">
                  <strong>
                    {blocking.started ? 'Session in progress' : 'Session starting shortly'}
                  </strong>
                  <div>
                    {blocking.client_name} · {formatWhen(blocking.scheduled_at)} · creator payout{' '}
                    {formatMoney(blocking.creator_payout_usd)}
                  </div>
                  <div className="dialog-note">
                    Reassign this booking before disabling. Disabling anyway leaves the client
                    without a creator.
                  </div>
                </div>
              )}
              <div>
                <strong>{c?.future_bookings.length ?? 0}</strong> confirmed future booking
                {(c?.future_bookings.length ?? 0) === 1 ? '' : 's'} will return to unassigned for
                dispatch.
                {(c?.future_bookings.length ?? 0) > 0 && (
                  <ul className="dialog-list">
                    {c!.future_bookings.slice(0, 5).map((b) => (
                      <li key={b.booking_id}>
                        {formatWhen(b.scheduled_at)} · {b.client_name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <strong>{formatMoney(c?.pending_payouts.total_usd ?? 0)}</strong> in pending
                payouts ({c?.pending_payouts.count ?? 0}) stays owed. Disabling does not cancel
                the obligation and voids nothing.
              </div>
            </div>
          )}

          <label className="dialog-label">
            Reason (required, recorded in the audit log)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this account being disabled?"
            />
          </label>
          {error && <p className="dialog-warn">{error}</p>}
          <div className="dialog-actions">
            <button className="btn-ghost" onClick={() => setOpen(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              disabled={reason.trim().length < 3 || disable.isPending}
              onClick={() => disable.mutate({ reason: reason.trim(), force: Boolean(blocking) })}
            >
              {disable.isPending
                ? 'Disabling…'
                : blocking
                  ? 'Disable anyway'
                  : 'Disable account'}
            </button>
          </div>
        </Dialog>
      )}

      {open === 'restore' && (
        <Dialog
          onClose={() => {
            setOpen(null);
            setSummary(null);
          }}
          title={summary ? 'Access restored' : 'Restore access?'}
        >
          {summary ? (
            <>
              <p className="dialog-lead">
                They can sign in again now, and have been notified.
              </p>
              <div className="dialog-facts">
                <div>
                  <strong>{summary.bookings_reassigned}</strong> booking
                  {summary.bookings_reassigned === 1 ? '' : 's'} reassigned to another creator —
                  these stay with the replacement.
                </div>
                <div>
                  <strong>{summary.bookings_unassigned}</strong> returned to dispatch — these stay
                  unassigned unless you assign them back.
                </div>
                <div>
                  <strong>{formatMoney(summary.payouts_moved_usd)}</strong> in payouts moved to
                  replacements.
                </div>
                <div>
                  <strong>{formatMoney(summary.pending_payouts.total_usd)}</strong> still owed to
                  them ({summary.pending_payouts.count}).
                </div>
                <div className="dialog-note">
                  Their availability is switched OFF — they must set themselves Available before
                  they appear in matching or the dispatch picker.
                </div>
              </div>
              <div className="dialog-actions">
                <button
                  className="btn"
                  onClick={() => {
                    setOpen(null);
                    setSummary(null);
                  }}
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="dialog-lead">
                Login and full app access return immediately, with no re-verification. Their
                creator approval, specialties, schedule, portfolio and ID verification are
                untouched, and any pending payouts are still owed.
              </p>
              <p className="dialog-note">
                What does <strong>not</strong> come back: bookings reassigned to another creator
                stay with that creator, bookings returned to dispatch stay unassigned, and
                notifications suppressed while they were off are gone rather than queued. Their
                availability starts switched off so they opt back in deliberately.
              </p>
              <label className="dialog-label">
                Reason (optional, recorded in the audit log)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Why is access being restored?"
                />
              </label>
              {error && <p className="dialog-warn">{error}</p>}
              <div className="dialog-actions">
                <button className="btn-ghost" onClick={() => setOpen(null)}>
                  Cancel
                </button>
                <button
                  className="btn"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate({ reason: reason.trim() })}
                >
                  {restore.isPending ? 'Restoring…' : 'Restore access'}
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}
