import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Pill, SectionSkeleton, formatMoney, formatWhen } from '../components/ui';

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

export function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => api<BookingDetailData>(`/v1/admin/bookings/${id}`),
  });

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

  if (isLoading) {
    return (
      <>
        <h1 className="page-title">Booking</h1>
        <SectionSkeleton rows={5} />
      </>
    );
  }
  if (isError || !data) {
    return (
      <>
        <h1 className="page-title">Booking</h1>
        <EmptyState glyph="⚠">{(error as Error | undefined)?.message ?? 'Not found'}</EmptyState>
      </>
    );
  }

  const { booking: b, session } = data;
  const isAdmin = identity?.role === 'admin';
  const dispatchable = b.status === 'pending' && !b.creator_id;
  const snapshot = Object.entries(b.pricing_snapshot ?? {}).filter(([, v]) => typeof v !== 'object');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          {b.occasion ?? b.type} · {formatMoney(Number(b.price_usd))}
        </h1>
        <Pill status={b.status} />
        {b.legal_hold && <Pill tone="danger">legal hold</Pill>}
        {dispatchable && <Pill tone="warn">needs dispatch</Pill>}
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
      </div>
      <p className="page-sub num">
        {b.id} · created {formatWhen(b.created_at)}
        {b.reschedule_count > 0 ? ` · rescheduled ×${b.reschedule_count}` : ''}
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      {assigning && dispatchable && (
        <div className="section">
          <h2>Assign a creator</h2>
          {data.eligible_creators.length === 0 ? (
            <EmptyState glyph="—">
              No eligible creators (approved + available + specialty match). Check the Creators roster.
            </EmptyState>
          ) : (
            <div className="card row-list">
              {data.eligible_creators.map((c) => (
                <div key={c.user_id} className="row">
                  <div className="who grow">
                    <div className="name">
                      {c.full_name}
                      {c.verified ? ' ✓' : ''}
                    </div>
                    <div className="sub">
                      {c.base_area ?? 'no base area'}
                      {c.distance_km != null ? ` · ${c.distance_km.toFixed(1)} km away` : ''}
                    </div>
                  </div>
                  <button
                    className="btn"
                    disabled={assign.isPending}
                    onClick={() => {
                      if (window.confirm(`Assign to ${c.full_name}? They get the offer with the normal accept window.`))
                        assign.mutate(c.user_id);
                    }}
                  >
                    Assign
                  </button>
                </div>
              ))}
            </div>
          )}
          {b.declined_creators.length > 0 && (
            <p className="page-sub" style={{ marginTop: 8 }}>
              Already declined: {b.declined_creators.join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="section">
        <h2>Facts</h2>
        <div className="card kv">
          <div>
            <div className="k">Client</div>
            <div className="v">
              <Link to={`/users/${b.client_id}`}>{b.client_name ?? 'client'} →</Link>
            </div>
          </div>
          <div>
            <div className="k">Creator</div>
            <div className="v">
              {b.creator_id ? <Link to={`/creators/${b.creator_id}`}>{b.creator_name ?? 'creator'} →</Link> : '—'}
            </div>
          </div>
          <div>
            <div className="k">When</div>
            <div className="v">{b.scheduled_at ? formatWhen(b.scheduled_at) : 'not scheduled'}</div>
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

      {session && (session.client_checked_in_at || session.creator_checked_in_at || session.session_active_at) && (
        <div className="section">
          <h2>Session</h2>
          <div className="card kv">
            <div>
              <div className="k">Client check-in</div>
              <div className="v num">{session.client_checked_in_at ? formatWhen(session.client_checked_in_at) : '—'}</div>
            </div>
            <div>
              <div className="k">Creator check-in</div>
              <div className="v num">{session.creator_checked_in_at ? formatWhen(session.creator_checked_in_at) : '—'}</div>
            </div>
            <div>
              <div className="k">Started</div>
              <div className="v num">{session.session_active_at ? formatWhen(session.session_active_at) : '—'}</div>
            </div>
            <div>
              <div className="k">Ended</div>
              <div className="v num">{session.session_ended_at ? formatWhen(session.session_ended_at) : '—'}</div>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <h2>Money</h2>
        {snapshot.length > 0 && (
          <div className="card kv" style={{ marginBottom: 10 }}>
            {snapshot.map(([k, v]) => (
              <div key={k}>
                <div className="k">{k.replace(/_/g, ' ')}</div>
                <div className="v num">{String(v)}</div>
              </div>
            ))}
          </div>
        )}
        {data.transactions.length === 0 ? (
          <EmptyState glyph="—">No transactions recorded.</EmptyState>
        ) : (
          <div className="card row-list">
            {data.transactions.map((t) => (
              <div key={t.id} className="row">
                <div className="who grow">
                  <div className="name">
                    {t.type} · {formatMoney(Number(t.amount_usd))}
                  </div>
                  <div className="sub">{formatWhen(t.created_at)}</div>
                </div>
                <Pill tone={t.status === 'succeeded' ? 'ok' : t.status === 'failed' ? 'danger' : 'warn'}>{t.status}</Pill>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.disputes.length > 0 && (
        <div className="section">
          <h2>Disputes</h2>
          <div className="card row-list">
            {data.disputes.map((d) => (
              <div key={d.id} className="row">
                <div className="who grow">
                  <div className="name">
                    {d.category.replace(/_/g, ' ')} · opened by {d.opened_by_name ?? 'user'}
                  </div>
                  <div className="sub">
                    {formatWhen(d.created_at)}
                    {d.resolution ? ` · ${d.resolution}` : ''}
                  </div>
                </div>
                <Pill status={d.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h2>Files &amp; revisions</h2>
        <div className="card kv">
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
              {data.revisions.length === 0
                ? 'none'
                : data.revisions.map((r) => r.status).join(', ')}
            </div>
          </div>
        </div>
      </div>

      {data.admin_history.length > 0 && (
        <div className="section">
          <h2>Admin history</h2>
          <div className="card row-list">
            {data.admin_history.map((a) => (
              <div key={a.id} className="row">
                <div className="who grow">
                  <div className="name">{a.action.replace(/_/g, ' ')}</div>
                  <div className="sub">
                    {a.admin_name ?? 'admin'} · {formatWhen(a.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
