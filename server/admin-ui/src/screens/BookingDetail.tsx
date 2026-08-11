import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { NotesThread } from '../components/NotesThread';
import { ListState, Pill, fetchState, formatMoney, formatWhen } from '../components/ui';

interface BookingDetailData {
  booking: {
    id: string;
    status: string;
    type: string;
    occasion: string | null;
    media_kind: string;
    duration_hours: number | null;
    area: string | null;
    meeting_point: string | null;
    meeting_lat: number | null;
    meeting_lng: number | null;
    scheduled_at: string | null;
    reschedule_count: number;
    price_usd: number;
    pricing_snapshot: Record<string, unknown>;
    legal_hold: boolean | null;
    delivered_at: string | null;
    cancelled_at: string | null;
    created_at: string;
    client_id: string;
    creator_id: string | null;
    client_name: string | null;
    creator_name: string | null;
    declined_creators: string[];
    /** Raw ids behind `declined_creators` — the only reliable way to tell
        whether a specific eligible creator has already passed on this job. */
    declined_creator_ids: string[];
    offer_expires_at: string | null;
  };
  session: {
    client_checked_in_at: string | null;
    creator_checked_in_at: string | null;
    session_active_at: string | null;
    session_ended_at: string | null;
  } | null;
  transactions: { id: string; type: string; status: string; amount_usd: number; created_at: string }[];
  disputes: { id: string; category: string; status: string; resolution: string | null; created_at: string; opened_by_name: string | null }[];
  media_summary: { total: number; deliverables: number; deleted: number };
  revisions: { id: string; status: string; notes: string | null; created_at: string }[];
  admin_history: { id: string; action: string; detail: Record<string, unknown>; created_at: string; admin_name: string | null }[];
  eligible_creators: {
    user_id: string;
    full_name: string;
    verified: boolean;
    base_area: string | null;
    distance_km?: number | null;
  }[];
}

const txTone = (status: string) => (status === 'succeeded' ? 'ok' : status === 'failed' ? 'danger' : 'warn');

export function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const q = useQuery({
    queryKey: ['booking', id],
    queryFn: () => api<BookingDetailData>(`/v1/admin/bookings/${id}`),
  });
  const { data, error, refetch } = q;
  const { state } = fetchState(q);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['booking', id] });
  const assign = useMutation({
    mutationFn: (creator_id: string) =>
      api(`/v1/admin/bookings/${id}/assign`, { method: 'POST', body: JSON.stringify({ creator_id }) }),
    onSuccess: () => {
      setActionError(null);
      setAssigning(false);
    },
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const legalHold = useMutation({
    mutationFn: (hold: boolean) =>
      api(`/v1/admin/bookings/${id}/legal-hold`, { method: 'POST', body: JSON.stringify({ hold }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const resend = useMutation({
    mutationFn: (kind: 'booking_confirmation' | 'refund_notice') =>
      api('/v1/admin/resend-email', { method: 'POST', body: JSON.stringify({ kind, booking_id: id }) }),
    onSuccess: (_res, kind) => {
      setActionError(null);
      setSentFlash(kind === 'booking_confirmation' ? 'Confirmation email re-sent to the client.' : 'Refund notice re-sent to the client.');
    },
    onError: (e) => setActionError((e as Error).message),
  });

  // One request for the whole page, so a failure is page-level — and must
  // never read as a booking with nothing on it.
  if (state !== 'success' || !data) {
    return (
      <>
        <h1 className="page-title">Booking</h1>
        <div style={{ marginTop: 16 }}>
          <ListState
            status={state}
            error={(error as Error | null)?.message}
            errorHint="This booking's record could not be read. Nothing is known about it from this screen — it is not an empty or missing booking."
            onRetry={() => refetch()}
            rows={5}
            empty=""
          >
            <></>
          </ListState>
        </div>
      </>
    );
  }

  const { booking: b, session } = data;
  const isAdmin = identity?.role === 'admin';
  const dispatchable = b.status === 'pending' && !b.creator_id;
  const snapshot = Object.entries(b.pricing_snapshot ?? {}).filter(([, v]) => typeof v !== 'object');
  const hasSession =
    session && (session.client_checked_in_at || session.creator_checked_in_at || session.session_active_at);

  return (
    <>
      <div className="detail-head">
        <h1 className="page-title">
          {b.occasion ?? b.type} · {formatMoney(Number(b.price_usd))}
        </h1>
        <Pill status={b.status} />
        {b.legal_hold && <Pill tone="danger">legal hold</Pill>}
        {dispatchable && <Pill tone="warn">needs dispatch</Pill>}

        <div className="detail-actions">
          {isAdmin && dispatchable && (
            <button className="btn" onClick={() => setAssigning((v) => !v)}>
              {assigning ? 'Close' : 'Assign creator'}
            </button>
          )}
          {isAdmin && (
            <button
              className="btn ghost"
              disabled={legalHold.isPending}
              onClick={() => {
                const next = !b.legal_hold;
                if (
                  window.confirm(
                    next
                      ? 'Place a legal hold? Files for this booking become ineligible for retention deletion until lifted (+90 days).'
                      : 'Lift the legal hold? Retention resumes 90 days after lifting.',
                  )
                )
                  legalHold.mutate(next);
              }}
            >
              {b.legal_hold ? 'Lift legal hold' : 'Legal hold'}
            </button>
          )}
          {['confirmed', 'completed', 'disputed'].includes(b.status) && (
            <button
              className="btn ghost"
              disabled={resend.isPending}
              onClick={() => {
                if (window.confirm('Re-send the booking confirmation email to the client?')) resend.mutate('booking_confirmation');
              }}
            >
              ✉ Resend confirmation
            </button>
          )}
          {data.transactions.some((t) => t.type === 'refund') && (
            <button
              className="btn ghost"
              disabled={resend.isPending}
              onClick={() => {
                if (window.confirm('Re-send the refund notice email to the client?')) resend.mutate('refund_notice');
              }}
            >
              ✉ Resend refund notice
            </button>
          )}
        </div>
      </div>
      <p className="page-sub num">
        {b.id} · created {formatWhen(b.created_at)}
        {b.reschedule_count > 0 ? ` · rescheduled ×${b.reschedule_count}` : ''}
      </p>
      {sentFlash && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--ok)', margin: '14px 0' }}>
          {sentFlash}
        </div>
      )}
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', margin: '14px 0' }}>
          {actionError}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {/* Notes lead: the case context before the case facts. */}
        <NotesThread subjectType="booking" subjectId={b.id} />
      </div>

      {assigning && dispatchable && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Assign a creator</h2>
            <span className="meta num">{data.eligible_creators.length} eligible</span>
          </div>
          {data.eligible_creators.length === 0 ? (
            <div className="lst-inline empty">
              <span>—</span>
              <span>
                No eligible creators (approved + available + specialty match). Check the Creators roster.
              </span>
            </div>
          ) : (
            <div className="t-table-scroll">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Base area</th>
                    <th className="right">Distance</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.eligible_creators.map((c) => {
                    const alreadyDeclined = (b.declined_creator_ids ?? []).includes(c.user_id);
                    return (
                    <tr key={c.user_id}>
                      <td>
                        <div className="cell-title">
                          {c.full_name}
                          {c.verified ? ' ✓' : ''}
                        </div>
                        {alreadyDeclined && (
                          <div style={{ marginTop: 4 }}>
                            <Pill tone="warn">already passed on this job</Pill>
                          </div>
                        )}
                      </td>
                      <td>{c.base_area ?? <span style={{ color: 'var(--muted)' }}>no base area</span>}</td>
                      <td className="right nowrap num">
                        {c.distance_km != null ? `${c.distance_km.toFixed(1)} km` : '—'}
                      </td>
                      <td className="right">
                        <div className="cell-actions">
                          <button
                            className={`btn${alreadyDeclined ? ' ghost' : ''}`}
                            disabled={assign.isPending}
                            onClick={() => {
                              // Re-dispatching someone who already passed is
                              // allowed — sometimes it is exactly right after
                              // a phone call — but it must not be silent: each
                              // further pass counts toward the auto-cancel
                              // threshold that refunds the client.
                              const message = alreadyDeclined
                                ? `${c.full_name} has ALREADY passed on this booking.\n\nRe-assigning is allowed, but if they pass again it counts toward the limit that auto-cancels this booking and refunds the client in full.\n\nOffer it to them again anyway?`
                                : `Assign to ${c.full_name}? They get the offer with the normal accept window.`;
                              if (window.confirm(message)) assign.mutate(c.user_id);
                            }}
                          >
                            {alreadyDeclined ? 'Offer again' : 'Assign'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {b.declined_creators.length > 0 && (
            <p className="page-sub" style={{ marginTop: 12 }}>
              Already declined: {b.declined_creators.join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Facts</h2>
        </div>
        <div className="facts">
          <div>
            <div className="k">Client</div>
            <div className="v">
              <Link to={`/users/${b.client_id}`}>{b.client_name ?? 'client'} →</Link>
            </div>
          </div>
          <div>
            <div className="k">Creator</div>
            <div className="v">
              {b.creator_id ? (
                <Link to={`/creators/${b.creator_id}`}>{b.creator_name ?? 'creator'} →</Link>
              ) : (
                <span className="quiet">—</span>
              )}
            </div>
          </div>
          <div>
            <div className="k">When</div>
            <div className="v num">{b.scheduled_at ? formatWhen(b.scheduled_at) : 'not scheduled'}</div>
          </div>
          <div>
            <div className="k">Where</div>
            <div className="v">
              {b.type === 'remote' ? 'remote' : `${b.area ?? '—'}${b.meeting_point ? ` · ${b.meeting_point}` : ''}`}
            </div>
          </div>
          <div>
            <div className="k">Format</div>
            <div className="v">
              {b.media_kind}
              {b.duration_hours ? ` · ${b.duration_hours}h` : ''}
            </div>
          </div>
          {b.offer_expires_at && b.status === 'pending' && b.creator_id && (
            <div>
              <div className="k">Offer expires</div>
              <div className="v num">{formatWhen(b.offer_expires_at)}</div>
            </div>
          )}
          {b.delivered_at && (
            <div>
              <div className="k">Delivered</div>
              <div className="v num">{formatWhen(b.delivered_at)}</div>
            </div>
          )}
          {b.cancelled_at && (
            <div>
              <div className="k">Cancelled</div>
              <div className="v num">{formatWhen(b.cancelled_at)}</div>
            </div>
          )}
        </div>
      </div>

      {hasSession && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Session</h2>
          </div>
          <div className="facts">
            <div>
              <div className="k">Client check-in</div>
              <div className="v num">{session!.client_checked_in_at ? formatWhen(session!.client_checked_in_at) : '—'}</div>
            </div>
            <div>
              <div className="k">Creator check-in</div>
              <div className="v num">{session!.creator_checked_in_at ? formatWhen(session!.creator_checked_in_at) : '—'}</div>
            </div>
            <div>
              <div className="k">Started</div>
              <div className="v num">{session!.session_active_at ? formatWhen(session!.session_active_at) : '—'}</div>
            </div>
            <div>
              <div className="k">Ended</div>
              <div className="v num">{session!.session_ended_at ? formatWhen(session!.session_ended_at) : '—'}</div>
            </div>
          </div>
        </div>
      )}

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Money</h2>
          <span className="meta num">{data.transactions.length} transaction{data.transactions.length === 1 ? '' : 's'}</span>
        </div>
        {snapshot.length > 0 && (
          <div className="facts" style={{ marginBottom: 18 }}>
            {snapshot.map(([k, v]) => (
              <div key={k}>
                <div className="k">{k.replace(/_/g, ' ')}</div>
                <div className="v num">{String(v)}</div>
              </div>
            ))}
          </div>
        )}
        {data.transactions.length === 0 ? (
          <div className="lst-inline empty">
            <span>—</span>
            <span>No transactions recorded against this booking.</span>
          </div>
        ) : (
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="right">Amount</th>
                  <th>When</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td><span className="cell-title">{t.type}</span></td>
                    <td className="right nowrap num">{formatMoney(Number(t.amount_usd))}</td>
                    <td className="nowrap num">{formatWhen(t.created_at)}</td>
                    <td className="right">
                      <div className="cell-pills"><Pill tone={txTone(t.status)}>{t.status}</Pill></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.disputes.length > 0 && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Disputes</h2>
            <span className="meta num">{data.disputes.length}</span>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {data.disputes.map((d) => (
              <div key={d.id} className="tl-card">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="tl-title">
                    {d.category.replace(/_/g, ' ')} · opened by {d.opened_by_name ?? 'user'}
                  </span>
                  <Pill status={d.status} />
                  <span className="tl-when" style={{ marginLeft: 'auto' }}>{formatWhen(d.created_at)}</span>
                </div>
                {d.resolution && <div className="tl-sub" style={{ marginTop: 4 }}>{d.resolution}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Files &amp; revisions</h2>
        </div>
        <div className="facts">
          <div>
            <div className="k">Media files</div>
            <div className="v num">
              {data.media_summary.total} total · {data.media_summary.deliverables} deliverable
              {data.media_summary.deleted ? ` · ${data.media_summary.deleted} deleted by retention` : ''}
            </div>
          </div>
          <div>
            <div className="k">Revision requests</div>
            <div className="v num">
              {data.revisions.length === 0 ? 'none' : data.revisions.map((r) => r.status).join(', ')}
            </div>
          </div>
        </div>
      </div>

      {data.admin_history.length > 0 && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Admin history</h2>
            <span className="meta num">{data.admin_history.length}</span>
          </div>
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Admin</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.admin_history.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap"><span className="cell-title">{a.action.replace(/_/g, ' ')}</span></td>
                    <td className="nowrap">{a.admin_name ?? 'admin'}</td>
                    <td className="nowrap num">{formatWhen(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
