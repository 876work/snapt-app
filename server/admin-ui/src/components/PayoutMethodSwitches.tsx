import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * Payout method availability — the operational switch.
 *
 * A bank goes down or a wallet provider has problems and the six methods a
 * creator can cash out to need to change TODAY, without an app release. This
 * is that control. The server refuses cash-outs against a disabled method
 * (server/src/routes/earnings.ts); this screen is how the state gets set.
 *
 * Turning one OFF asks for a reason and shows how many creators currently
 * have that method saved as their preference — the number is the whole point
 * of the confirmation, because those are the people who will be told to pick
 * another method next time they cash out. The optional note is shown to them
 * verbatim, so "Bank transfers are paused until Monday" beats a generic
 * "unavailable".
 */
interface MethodRow {
  id: string;
  name: string;
  eta: string;
  enabled: boolean;
  note: string | null;
  saved_count: number;
}

export function PayoutMethodSwitches({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<MethodRow | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payout-methods'],
    queryFn: () => api<{ methods: MethodRow[] }>('/v1/admin/payout-methods'),
  });

  const flip = useMutation({
    mutationFn: (body: { id: string; enabled: boolean; reason?: string; note?: string }) =>
      api<{ updated: boolean }>(`/v1/admin/payout-methods/${body.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: body.enabled, reason: body.reason, note: body.note }),
      }),
    onSuccess: () => {
      setOpen(null);
      setReason('');
      setNote('');
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['payout-methods'] }),
  });

  const methods = data?.methods ?? [];
  const allOff = methods.length > 0 && methods.every((m) => !m.enabled);

  return (
    <div className="card" style={{ padding: 16, marginBottom: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong>Payout methods</strong>
        <span className="sub" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          Turn a method off when a bank or provider is down — takes effect immediately, no app
          update.
        </span>
      </div>

      {allOff && (
        <div className="card" style={{ padding: 10, borderLeft: '4px solid var(--danger)', fontSize: 12.5 }}>
          <strong>Every method is off.</strong> No creator can cash out. They see an honest
          "temporarily unavailable" message rather than a broken screen, but nothing is being paid
          out until at least one is back on.
        </div>
      )}

      {isLoading ? (
        <div className="sub" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : isError ? (
        <div className="sub" style={{ color: 'var(--danger)' }}>
          Couldn't load payout method state — reload the page.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {methods.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 0',
                borderTop: '1px solid var(--line)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {m.name}{' '}
                  <span className="sub" style={{ color: 'var(--muted)', fontWeight: 400 }}>
                    · {m.eta}
                  </span>
                </div>
                <div className="sub" style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {m.saved_count} creator{m.saved_count === 1 ? '' : 's'} using it
                  {m.note ? ` · note: "${m.note}"` : ''}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: m.enabled ? 'var(--ok)' : 'var(--danger)',
                }}
              >
                {m.enabled ? 'On' : 'Off'}
              </span>
              <button
                className={m.enabled ? 'btn-ghost danger' : 'btn-ghost'}
                disabled={!canEdit || flip.isPending}
                onClick={() => {
                  setError(null);
                  setReason('');
                  setNote('');
                  if (m.enabled) setOpen(m);
                  // Re-enabling needs no reason: restoring a service is not
                  // the act that needs justifying.
                  else flip.mutate({ id: m.id, enabled: true });
                }}
              >
                {m.enabled ? 'Turn off' : 'Turn on'}
              </button>
            </div>
          ))}
        </div>
      )}
      {!canEdit && (
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 12 }}>
          Changing availability needs the admin role.
        </div>
      )}

      {open && (
        <div className="dialog-backdrop" onClick={() => setOpen(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="dialog-title">Turn off {open.name}?</h3>
            <p className="dialog-lead">
              Creators will not be able to cash out to {open.name} until it is turned back on.
              Requests already submitted are unaffected — they stay in the queue and still need
              paying.
            </p>
            <div className="dialog-facts">
              {open.saved_count > 0 ? (
                <div className="dialog-warn">
                  <strong>
                    {open.saved_count} creator{open.saved_count === 1 ? '' : 's'} ha
                    {open.saved_count === 1 ? 's' : 've'} this saved as their payout method
                  </strong>
                  <div className="dialog-note">
                    They keep their saved details — nothing is deleted. Next time they cash out
                    they will be asked to pick another method.
                  </div>
                </div>
              ) : (
                <div>No creator currently has this saved as their payout method.</div>
              )}
            </div>
            <label className="dialog-label">
              Reason (required, recorded in the audit log)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why is this being turned off?"
              />
            </label>
            <label className="dialog-label">
              Note shown to creators (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Bank transfers are paused until Monday"
              />
            </label>
            {error && <p className="dialog-warn">{error}</p>}
            <div className="dialog-actions">
              <button className="btn-ghost" onClick={() => setOpen(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                disabled={reason.trim().length < 3 || flip.isPending}
                onClick={() =>
                  flip.mutate({
                    id: open.id,
                    enabled: false,
                    reason: reason.trim(),
                    note: note.trim() || undefined,
                  })
                }
              >
                {flip.isPending ? 'Turning off…' : `Turn off ${open.name}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
