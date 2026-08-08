import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { NotesThread } from '../components/NotesThread';
import { VerificationPanel } from '../components/VerificationPanel';
import { EmptyState, Pill, SectionSkeleton, formatMoney, formatWhen } from '../components/ui';

interface CreatorDetailData {
  profile: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    created_at: string;
    suspended_at: string | null;
  } | null;
  creator: {
    portfolio_link?: string | null;
    declared_legal_name?: string | null;
    headshot_url?: string | null;
    headshot_status?: 'pending' | 'approved' | 'rejected' | null;
    user_id: string;
    vetting_status: string;
    background_check_status: string;
    background_check_completed_at: string | null;
    specialties: string[];
    service_type: string;
    service_radius_km: number | null;
    base_area: string | null;
    bio: string | null;
    blocked_dates: string[];
    verified: boolean;
    promo_fee_rate: number | null;
    is_available: boolean;
    applied_at: string | null;
    rejection_reason: string | null;
    payout_summary: { selected: string | null; configured: string[] };
  };
  standing: { activeWeight: number; tierLabel: string };
  strikes: {
    id: string;
    type: string;
    weight: number;
    occurred_at: string;
    expires_at: string;
    contested: boolean;
    overturned: boolean;
  }[];
  earnings: { pending: number; available: number; paid_out: number };
  rating: { average: number | null; count: number };
  reviews: { id: string; rating: number; comment: string | null; created_at: string; client_name: string | null }[];
  portfolio: { id: string; caption: string | null; status: string; created_at: string }[];
  bookings: {
    id: string;
    status: string;
    occasion: string | null;
    type: string;
    area: string | null;
    scheduled_at: string | null;
    price_usd: number;
    client_name: string | null;
  }[];
}

export function CreatorDetail() {
  const { id } = useParams<{ id: string }>();
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['creator', id],
    queryFn: () => api<CreatorDetailData>(`/v1/admin/creators/${id}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['creator', id] });
  const approve = useMutation({
    mutationFn: (background_check_passed: boolean) =>
      api(`/v1/admin/creators/${id}/approve`, { method: 'POST', body: JSON.stringify({ background_check_passed }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const reject = useMutation({
    mutationFn: (reason: string) =>
      api(`/v1/admin/creators/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const headshotReview = useMutation({
    mutationFn: (approve: boolean) =>
      api(`/v1/admin/creators/${id}/headshot-review`, { method: 'POST', body: JSON.stringify({ approve }) }),
    onSuccess: refresh,
  });

  const overturn = useMutation({
    mutationFn: (strikeId: string) => api(`/v1/admin/strikes/${strikeId}/overturn`, { method: 'POST' }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });

  if (isLoading) {
    return (
      <>
        <h1 className="page-title">Creator</h1>
        <SectionSkeleton rows={5} />
      </>
    );
  }
  if (isError || !data) {
    return (
      <>
        <h1 className="page-title">Creator</h1>
        <EmptyState glyph="⚠">{(error as Error | undefined)?.message ?? 'Not found'}</EmptyState>
      </>
    );
  }

  const { profile, creator, standing } = data;
  const isAdmin = identity?.role === 'admin';
  const inReview = creator.vetting_status === 'in_review';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          {profile?.full_name || '(no name)'}
        </h1>
        <Pill status={creator.vetting_status} />
        {creator.verified && <Pill tone="brand">verified</Pill>}
      {/* The applicant's face, front and centre of review — spec'd from the
          start, previously never displayed. */}
      {creator.headshot_url ? (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 14, alignItems: 'center' }}>
          <img
            src={creator.headshot_url}
            alt="Creator headshot"
            style={{ width: 96, height: 96, borderRadius: 12, objectFit: 'cover' }}
          />
          <div style={{ flex: 1 }}>
            <div className="k">Headshot</div>
            <Pill
              tone={creator.headshot_status === 'approved' ? 'brand' : creator.headshot_status === 'rejected' ? 'danger' : 'neutral'}
            >
              {creator.headshot_status ?? 'none'}
            </Pill>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {creator.headshot_status === 'pending'
                ? inReview
                  ? 'Approving the application approves this photo with it.'
                  : 'Uploaded after approval — needs a separate review before clients see it.'
                : creator.headshot_status === 'approved'
                  ? 'Live on client surfaces.'
                  : 'Not shown to clients.'}
            </div>
          </div>
          {creator.headshot_status === 'pending' && !inReview && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={headshotReview.isPending} onClick={() => headshotReview.mutate(true)}>
                Approve photo
              </button>
              <button
                className="btn btn-danger"
                disabled={headshotReview.isPending}
                onClick={() => window.confirm('Reject this headshot? The creator is asked to upload a new one.') && headshotReview.mutate(false)}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="k">Headshot</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            None uploaded — this creator renders as an initial-letter tile in the app.
          </div>
        </div>
      )}
      {creator.portfolio_link && (
        <div className="card" style={{ padding: 12, marginBottom: 12, borderLeft: '4px solid var(--gold, #C9A227)' }}>
          <div className="k">Portfolio</div>
          <a href={creator.portfolio_link} target="_blank" rel="noreferrer noopener" style={{ fontSize: 15, fontWeight: 700 }}>
            {creator.portfolio_link}
          </a>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 3 }}>
            Their own work — the best evidence for this decision. Opens in a new tab.
          </div>
        </div>
      )}

        {creator.vetting_status === 'approved' && !creator.is_available && <Pill tone="neutral">paused</Pill>}
        {isAdmin && inReview && (
          <>
            <button
              className="btn"
              disabled={approve.isPending}
              onClick={() => {
                const passed = window.confirm(
                  'Has the background check PASSED?\n\nOK = passed (grants the verified badge). Cancel = approve without the badge for now.',
                );
                approve.mutate(passed);
              }}
            >
              Approve
            </button>
            <button
              className="btn danger"
              disabled={reject.isPending}
              onClick={() => {
                const reason = window.prompt('Rejection reason (required — sent to the applicant, reapplying stays open):');
                if (reason?.trim()) reject.mutate(reason.trim());
              }}
            >
              Reject
            </button>
          </>
        )}
      </div>
      <p className="page-sub">
        {profile?.email ?? 'no email'} · {profile?.phone ?? 'no phone'}
        {creator.applied_at ? ` · applied ${formatWhen(creator.applied_at)}` : ''} ·{' '}
        <Link to={`/users/${creator.user_id}`}>customer record →</Link>
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}
      {creator.vetting_status === 'rejected' && creator.rejection_reason && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--warn)', marginBottom: 12 }}>
          Rejected: {creator.rejection_reason}
        </div>
      )}

      {/* Notes lead: what the team knows before the application facts. */}
      <VerificationPanel creatorId={creator.user_id} />

      <NotesThread subjectType="creator" subjectId={creator.user_id} />

      <div className="section">
        <h2>Application</h2>
        <div className="card kv">
          <div>
            <div className="k">Specialties</div>
            <div className="v">{creator.specialties.join(', ')}</div>
          </div>
          <div>
            <div className="k">Service type</div>
            <div className="v">{creator.service_type}</div>
          </div>
          <div>
            <div className="k">Base area</div>
            <div className="v">{creator.base_area ?? '—'}</div>
          </div>
          <div>
            <div className="k">Radius</div>
            <div className="v num">{creator.service_radius_km ? `${creator.service_radius_km} km` : '—'}</div>
          </div>
          <div>
            <div className="k">Background check</div>
            <div className="v">
              {creator.background_check_status.replace(/_/g, ' ')}
              {creator.background_check_completed_at ? ` · ${formatWhen(creator.background_check_completed_at)}` : ''}
            </div>
          </div>
          <div>
            <div className="k">Payout method</div>
            <div className="v">
              {creator.payout_summary.selected ?? 'not set'}
              {creator.payout_summary.configured.length
                ? ` (${creator.payout_summary.configured.join(', ')} on file)`
                : ''}
            </div>
          </div>
          {creator.promo_fee_rate != null && (
            <div>
              <div className="k">Promo fee rate</div>
              <div className="v num">{Math.round(creator.promo_fee_rate * 100)}%</div>
            </div>
          )}
        </div>
        {creator.bio && (
          <div className="card" style={{ padding: 14, marginTop: 10, color: 'var(--ink-2)' }}>{creator.bio}</div>
        )}
      </div>

      <div className="section">
        <h2>Money &amp; standing</h2>
        <div className="tiles">
          <div className="card tile">
            <div className="value num">{formatMoney(data.earnings.available)}</div>
            <div className="label">available / requested</div>
          </div>
          <div className="card tile">
            <div className="value num">{formatMoney(data.earnings.pending)}</div>
            <div className="label">pending (in hold)</div>
          </div>
          <div className="card tile">
            <div className="value num">{formatMoney(data.earnings.paid_out)}</div>
            <div className="label">paid out lifetime</div>
          </div>
          <div className="card tile">
            <div className="value num">
              {data.rating.average != null ? data.rating.average.toFixed(2) : '—'}
            </div>
            <div className="label">rating · {data.rating.count} review{data.rating.count === 1 ? '' : 's'}</div>
          </div>
          <div className="card tile">
            <div className="value num">{standing.activeWeight}</div>
            <div className="label">active strike weight ({standing.tierLabel})</div>
          </div>
        </div>
      </div>

      {data.strikes.length > 0 && (
        <div className="section">
          <h2>
            Strikes <span className="count num">{data.strikes.length}</span>
          </h2>
          <div className="card row-list">
            {data.strikes.map((s) => {
              const expired = Date.parse(s.expires_at) < Date.now();
              return (
                <div key={s.id} className="row">
                  <div className="who grow">
                    <div className="name">
                      {s.type.replace(/_/g, ' ')} · weight {s.weight}
                    </div>
                    <div className="sub">
                      {formatWhen(s.occurred_at)} · {expired ? 'expired' : `active until ${formatWhen(s.expires_at)}`}
                      {s.contested ? ' · contested' : ''}
                    </div>
                  </div>
                  {s.overturned ? (
                    <Pill tone="neutral">overturned</Pill>
                  ) : (
                    isAdmin && (
                      <button
                        className="btn ghost"
                        disabled={overturn.isPending}
                        onClick={() => {
                          if (window.confirm('Overturn this strike? It stops counting toward standing immediately.'))
                            overturn.mutate(s.id);
                        }}
                      >
                        Overturn
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="section">
        <h2>
          Recent bookings <span className="count num">{data.bookings.length || ''}</span>
        </h2>
        {data.bookings.length === 0 ? (
          <EmptyState glyph="—">No bookings as creator yet.</EmptyState>
        ) : (
          <div className="card row-list">
            {data.bookings.map((b) => (
              <Link key={b.id} to={`/bookings/${b.id}`} className="row row-link" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="who grow">
                  <div className="name">
                    {b.occasion ?? b.type} · {b.client_name ?? 'client'}
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

      {data.reviews.length > 0 && (
        <div className="section">
          <h2>Latest reviews</h2>
          <div className="card row-list">
            {data.reviews.map((r) => (
              <div key={r.id} className="row">
                <div className="who grow">
                  <div className="name num">
                    {'★'.repeat(Math.round(Number(r.rating)))} {Number(r.rating).toFixed(1)} · {r.client_name ?? 'client'}
                  </div>
                  {r.comment && <div className="sub">{r.comment}</div>}
                </div>
                <span className="sub" style={{ color: 'var(--muted)', fontSize: 12 }}>{formatWhen(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.portfolio.length > 0 && (
        <div className="section">
          <h2>
            Portfolio <span className="count num">{data.portfolio.length}</span>
          </h2>
          <div className="card row-list">
            {data.portfolio.map((p) => (
              <div key={p.id} className="row">
                <div className="who grow">
                  <div className="name">{p.caption || '(no caption)'}</div>
                  <div className="sub">{formatWhen(p.created_at)}</div>
                </div>
                <Pill
                  tone={p.status === 'published' || p.status === 'auto' ? 'ok' : p.status === 'pending' ? 'warn' : 'neutral'}
                >
                  {p.status}
                </Pill>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
