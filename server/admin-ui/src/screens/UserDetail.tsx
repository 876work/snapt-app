import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { NotesThread } from '../components/NotesThread';
import { EmptyState, Pill, SectionSkeleton, formatMoney, formatWhen } from '../components/ui';

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

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api<UserDetailData>(`/v1/admin/users/${id}`),
  });

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

  if (isLoading) {
    return (
      <>
        <h1 className="page-title">Customer lookup</h1>
        <SectionSkeleton rows={5} />
      </>
    );
  }
  if (isError || !data) {
    return (
      <>
        <h1 className="page-title">Customer lookup</h1>
        <EmptyState glyph="⚠">{(error as Error | undefined)?.message ?? 'Not found'}</EmptyState>
      </>
    );
  }

  const { profile, creator, stats } = data;
  const suspended = Boolean(profile.suspended_at);

  const askReason = (verb: string): string | null => {
    const reason = window.prompt(`Reason for ${verb} (required — the user is notified and it is audited):`);
    return reason?.trim() || null;
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          {profile.full_name || '(no name)'}
        </h1>
        {suspended && <Pill status="suspended" />}
        {profile.deleted_at && <Pill tone="neutral">deleted account</Pill>}
        {creator && <Pill status={creator.vetting_status} />}
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
      <p className="page-sub">
        {profile.email ?? 'no email'} · {profile.phone ?? 'no phone'} · joined {formatWhen(profile.created_at)} ·
        prefers {profile.currency}
      </p>
      {sentFlash && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--ok)', marginBottom: 12 }}>
          {sentFlash}
        </div>
      )}
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      <div className="section">
        <div className="tiles">
          <div className="card tile">
            <div className="value num">{stats.bookings_total}</div>
            <div className="label">bookings ({stats.bookings_completed} completed)</div>
          </div>
          <div className="card tile">
            <div className="value num">{formatMoney(stats.lifetime_spend_usd)}</div>
            <div className="label">lifetime spend (net of refunds)</div>
          </div>
          <div className="card tile">
            <div className="value num">{stats.disputes_opened}</div>
            <div className="label">disputes opened</div>
          </div>
          <div className="card tile">
            <div className="value num">{profile.false_report_count}</div>
            <div className="label">false reports counted</div>
          </div>
        </div>
      </div>

      {creator && (
        <div className="section">
          <h2>Creator</h2>
          <div className="card kv">
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
              <div className="v">{creator.specialties.join(', ')}</div>
            </div>
            <div>
              <div className="k">Full record</div>
              <div className="v">
                <Link to={`/creators/${profile.id}`}>Open in Creators →</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <h2>
          Bookings <span className="count num">{data.bookings.length || ''}</span>
        </h2>
        {data.bookings.length === 0 ? (
          <EmptyState glyph="—">No bookings yet.</EmptyState>
        ) : (
          <div className="card row-list">
            {data.bookings.map((b) => (
              <Link key={b.id} to={`/bookings/${b.id}`} className="row row-link" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="who grow">
                  <div className="name">
                    {b.occasion ?? b.type}
                    {b.creator_name ? ` → ${b.creator_name}` : ''}
                  </div>
                  <div className="sub">
                    {b.area ?? (b.type === 'remote' ? 'remote' : '—')}
                    {b.scheduled_at ? ` · ${formatWhen(b.scheduled_at)}` : ''} · {formatMoney(Number(b.price_usd))}
                  </div>
                </div>
                <Pill status={b.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>
          Payments <span className="count num">{data.transactions.length || ''}</span>
        </h2>
        {data.transactions.length === 0 ? (
          <EmptyState glyph="—">No transactions yet.</EmptyState>
        ) : (
          <div className="card row-list">
            {data.transactions.map((t) => (
              <div key={t.id} className="row">
                <div className="who grow">
                  <div className="name">
                    {t.type} · {formatMoney(Number(t.amount_usd))}
                  </div>
                  <div className="sub">
                    {formatWhen(t.created_at)} · booking {t.booking_id.slice(0, 8)}
                  </div>
                </div>
                <Pill
                  tone={t.status === 'succeeded' ? 'ok' : t.status === 'failed' ? 'danger' : 'warn'}
                >
                  {t.status}
                </Pill>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.disputes.length > 0 && (
        <div className="section">
          <h2>
            Disputes opened <span className="count num">{data.disputes.length}</span>
          </h2>
          <div className="card row-list">
            {data.disputes.map((d) => (
              <div key={d.id} className="row">
                <div className="who grow">
                  <div className="name">{d.category.replace(/_/g, ' ')}</div>
                  <div className="sub">
                    {formatWhen(d.created_at)} · booking {d.booking_id.slice(0, 8)}
                  </div>
                </div>
                <Pill status={d.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h2>Policy consents</h2>
        {data.consents.length === 0 ? (
          <EmptyState glyph="—">No consent records.</EmptyState>
        ) : (
          <div className="card kv">
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

      <NotesThread subjectType="user" subjectId={profile.id} />

      <div className="section">
        <h2>Admin history</h2>
        {data.admin_history.length === 0 ? (
          <EmptyState glyph="—">No admin actions touch this account.</EmptyState>
        ) : (
          <div className="card row-list">
            {data.admin_history.map((a) => (
              <div key={a.id} className="row">
                <div className="who grow">
                  <div className="name">{a.action.replace(/_/g, ' ')}</div>
                  <div className="sub">
                    {a.admin_name ?? 'admin'} · {formatWhen(a.created_at)}
                    {a.detail && Object.keys(a.detail).length > 0
                      ? ` · ${Object.entries(a.detail)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' · ')}`
                      : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
