import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { NotesThread } from '../components/NotesThread';
import { ListState, Pill, fetchState, formatMoney, formatWhen } from '../components/ui';
import { AccountSwitch } from '../components/AccountSwitch';

interface UserDetailData {
  profile: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    mode: string;
    currency: string;
    created_at: string;
    suspended_at: string | null;
    status?: 'active' | 'disabled';
    deleted_at: string | null;
    false_report_count: number;
  };
  creator: {
    vetting_status: string;
    verified: boolean;
    is_available: boolean;
    service_type: string;
    specialties: string[];
    applied_at: string | null;
  } | null;
  stats: {
    bookings_total: number;
    bookings_completed: number;
    lifetime_spend_usd: number;
    disputes_opened: number;
  };
  bookings: {
    id: string;
    status: string;
    occasion: string | null;
    type: string;
    area: string | null;
    scheduled_at: string | null;
    price_usd: number;
    creator_name: string | null;
    created_at: string;
  }[];
  transactions: {
    id: string;
    booking_id: string;
    type: string;
    status: string;
    amount_usd: number;
    created_at: string;
  }[];
  disputes: {
    id: string;
    booking_id: string;
    category: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
  }[];
  consents: { doc_type: string; version: number; consented_at: string }[];
  admin_history: {
    id: string;
    action: string;
    detail: Record<string, unknown>;
    created_at: string;
    admin_name: string | null;
  }[];
}

const txTone = (status: string) => (status === 'succeeded' ? 'ok' : status === 'failed' ? 'danger' : 'warn');

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['user', id],
    queryFn: () => api<UserDetailData>(`/v1/admin/users/${id}`),
  });
  const { data, error, refetch } = q;
  const { state } = fetchState(q);

  const suspend = useMutation({
    mutationFn: (reason: string) =>
      api(`/v1/admin/users/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['user', id] }),
  });
  const unsuspend = useMutation({
    mutationFn: (reason: string) =>
      api(`/v1/admin/users/${id}/unsuspend`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['user', id] }),
  });
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const passwordLink = useMutation({
    mutationFn: () => api(`/v1/admin/users/${id}/send-password-link`, { method: 'POST' }),
    onSuccess: () => {
      setActionError(null);
      setSentFlash('Set-password email sent.');
    },
    onError: (e) => setActionError((e as Error).message),
  });
  const nudgeApply = useMutation({
    mutationFn: () => api(`/v1/admin/users/${id}/nudge-apply`, { method: 'POST' }),
    onSuccess: () => {
      setActionError(null);
      setSentFlash('“Become a creator” email sent.');
    },
    onError: (e) => setActionError((e as Error).message),
  });

  const askReason = (verb: string): string | null => {
    const reason = window.prompt(`Reason for ${verb} (required — the user is notified and it is audited):`);
    return reason?.trim() || null;
  };

  // The whole page is one request, so a failure is a page-level failure —
  // and it must not read as "this user has nothing on record".
  if (state !== 'success' || !data) {
    return (
      <>
        <h1 className="page-title">Customer lookup</h1>
        <div style={{ marginTop: 16 }}>
          <ListState
            status={state}
            error={(error as Error | null)?.message}
            errorHint="This account's record could not be read. Nothing is known about it from this screen — no bookings, no spend, no history. It is not an empty account."
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

  const { profile, creator, stats } = data;
  const suspended = Boolean(profile.suspended_at);

  return (
    <>
      <div className="detail-head">
        <h1 className="page-title">{profile.full_name || '(no name)'}</h1>
        {suspended && <Pill status="suspended" />}
        {profile.deleted_at && <Pill tone="neutral">deleted account</Pill>}
        {profile.status === 'disabled' && <Pill tone="warn">Disabled</Pill>}
        {creator && <Pill status={creator.vetting_status} />}

        <div className="detail-actions">
          {/* The hard off switch, distinct from Suspend beside it: no login,
              no app, no notifications. Admin-only. */}
          {identity?.role === 'admin' && (
            <AccountSwitch userId={profile.id} status={profile.status ?? 'active'} />
          )}
          {identity?.role === 'admin' &&
            (suspended ? (
              <button
                className="btn ghost"
                disabled={unsuspend.isPending}
                onClick={() => {
                  const reason = askReason('unsuspending');
                  if (reason) unsuspend.mutate(reason);
                }}
              >
                Unsuspend
              </button>
            ) : (
              <button
                className="btn danger"
                disabled={suspend.isPending}
                onClick={() => {
                  const reason = askReason('suspending this account');
                  if (reason) suspend.mutate(reason);
                }}
              >
                Suspend
              </button>
            ))}
          <button
            className="btn ghost"
            disabled={passwordLink.isPending}
            onClick={() => {
              if (window.confirm(`Email ${profile.email ?? 'this user'} a set-password link? It expires in 72 hours.`))
                passwordLink.mutate();
            }}
          >
            Send password link
          </button>
          {!creator && (
            <button
              className="btn ghost"
              disabled={nudgeApply.isPending}
              onClick={() => {
                if (window.confirm('Send the “Become a creator” email pointing them at the in-app application?'))
                  nudgeApply.mutate();
              }}
            >
              Invite to apply
            </button>
          )}
        </div>
      </div>
      <p className="page-sub">
        {profile.email ?? 'no email'} · {profile.phone ?? 'no phone'} · joined {formatWhen(profile.created_at)} ·
        prefers {profile.currency}
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
        {/* Notes lead: support reads context before acting on the account. */}
        <NotesThread subjectType="user" subjectId={profile.id} />
      </div>

      <div className="d-tiles" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="d-tile">
          <div className="n num">{stats.bookings_total}</div>
          <div className="lab">bookings ({stats.bookings_completed} completed)</div>
        </div>
        <div className="d-tile">
          <div className="n num">{formatMoney(stats.lifetime_spend_usd)}</div>
          <div className="lab">lifetime spend (net of refunds)</div>
        </div>
        <div className="d-tile">
          <div className="n num">{stats.disputes_opened}</div>
          <div className="lab">disputes opened</div>
        </div>
        <div className="d-tile">
          <div className="n num">{profile.false_report_count}</div>
          <div className="lab">false reports counted</div>
        </div>
      </div>

      {creator && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Creator</h2>
            <Link className="meta" to={`/creators/${profile.id}`}>Open in Creators →</Link>
          </div>
          <div className="facts">
            <div>
              <div className="k">Status</div>
              <div className="v">
                <Pill status={creator.vetting_status} /> {creator.verified ? '· verified' : ''}
              </div>
            </div>
            <div>
              <div className="k">Availability</div>
              <div className="v">{creator.is_available ? 'accepting bookings' : 'paused'}</div>
            </div>
            <div>
              <div className="k">Service type</div>
              <div className="v">{creator.service_type}</div>
            </div>
            <div>
              <div className="k">Specialties</div>
              <div className="v">{creator.specialties.length ? creator.specialties.join(', ') : '—'}</div>
            </div>
            <div>
              <div className="k">Applied</div>
              <div className="v num">
                {creator.applied_at ? formatWhen(creator.applied_at) : <span className="v quiet">—</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Bookings</h2>
          <span className="meta num">{data.bookings.length}</span>
        </div>
        {data.bookings.length === 0 ? (
          <div className="lst-inline empty">
            <span>—</span>
            <span>No bookings yet — this account has never booked a session.</span>
          </div>
        ) : (
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Where</th>
                  <th>Scheduled</th>
                  <th className="right">Price</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.bookings.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => navigate(`/bookings/${b.id}`)}>
                    <td>
                      <div className="cell-title">
                        {b.occasion ?? b.type}
                        {b.creator_name ? ` → ${b.creator_name}` : ''}
                      </div>
                    </td>
                    <td>{b.area ?? (b.type === 'remote' ? 'remote' : '—')}</td>
                    <td className="nowrap num">
                      {b.scheduled_at ? formatWhen(b.scheduled_at) : <span style={{ color: 'var(--muted)' }}>not scheduled</span>}
                    </td>
                    <td className="right nowrap num">{formatMoney(Number(b.price_usd))}</td>
                    <td className="right">
                      <div className="cell-pills"><Pill status={b.status} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Payments</h2>
          <span className="meta num">{data.transactions.length}</span>
        </div>
        {data.transactions.length === 0 ? (
          <div className="lst-inline empty">
            <span>—</span>
            <span>No transactions yet — no money has moved on this account.</span>
          </div>
        ) : (
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="right">Amount</th>
                  <th>When</th>
                  <th>Booking</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td><span className="cell-title">{t.type}</span></td>
                    <td className="right nowrap num">{formatMoney(Number(t.amount_usd))}</td>
                    <td className="nowrap num">{formatWhen(t.created_at)}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>
                      <Link to={`/bookings/${t.booking_id}`}>{t.booking_id.slice(0, 8)}</Link>
                    </td>
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
            <h2>Disputes opened</h2>
            <span className="meta num">{data.disputes.length}</span>
          </div>
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Opened</th>
                  <th>Resolved</th>
                  <th>Booking</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.disputes.map((d) => (
                  <tr key={d.id}>
                    <td><span className="cell-title">{d.category.replace(/_/g, ' ')}</span></td>
                    <td className="nowrap num">{formatWhen(d.created_at)}</td>
                    <td className="nowrap num">
                      {d.resolved_at ? formatWhen(d.resolved_at) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td className="num" style={{ color: 'var(--muted)' }}>
                      <Link to={`/bookings/${d.booking_id}`}>{d.booking_id.slice(0, 8)}</Link>
                    </td>
                    <td className="right">
                      <div className="cell-pills"><Pill status={d.status} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Policy consents</h2>
          <span className="meta num">{data.consents.length}</span>
        </div>
        {data.consents.length === 0 ? (
          <div className="lst-inline empty">
            <span>—</span>
            <span>No consent records for this account.</span>
          </div>
        ) : (
          <div className="facts">
            {data.consents.map((c) => (
              <div key={c.doc_type}>
                <div className="k">{c.doc_type.replace(/-/g, ' ')}</div>
                <div className="v num">
                  v{c.version} · {formatWhen(c.consented_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Admin history</h2>
          <span className="meta num">{data.admin_history.length}</span>
        </div>
        {data.admin_history.length === 0 ? (
          <div className="lst-inline empty">
            <span>✓</span>
            <span>No admin action has ever touched this account.</span>
          </div>
        ) : (
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Admin</th>
                  <th>When</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.admin_history.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap"><span className="cell-title">{a.action.replace(/_/g, ' ')}</span></td>
                    <td className="nowrap">{a.admin_name ?? 'admin'}</td>
                    <td className="nowrap num">{formatWhen(a.created_at)}</td>
                    {/* Chips rather than one stringified line, same as the
                        audit log — a config write here used to wrap to four. */}
                    <td>
                      {Object.keys(a.detail ?? {}).length === 0 ? (
                        <span style={{ color: 'var(--faint)' }}>—</span>
                      ) : (
                        <div className="kvchips">
                          {Object.entries(a.detail).map(([k, v]) => (
                            <span className="kvchip" key={k}>
                              <b>{k.replace(/_/g, ' ')}</b>
                              <span>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
