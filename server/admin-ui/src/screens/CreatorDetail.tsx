import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { NotesThread } from '../components/NotesThread';
import { VerificationPanel } from '../components/VerificationPanel';
import { ListState, Pill, fetchState, formatMoney, formatWhen } from '../components/ui';

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

const portfolioTone = (status: string) =>
  status === 'published' || status === 'auto' ? 'ok' : status === 'pending' ? 'warn' : 'neutral';

export function CreatorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['creator', id],
    queryFn: () => api<CreatorDetailData>(`/v1/admin/creators/${id}`),
  });
  const { data, error, refetch } = q;
  const { state } = fetchState(q);

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

  // One request for the whole page: a failure is page-level, and must not
  // read as a creator with an empty record.
  if (state !== 'success' || !data) {
    return (
      <>
        <h1 className="page-title">Creator</h1>
        <div style={{ marginTop: 16 }}>
          <ListState
            status={state}
            error={(error as Error | null)?.message}
            errorHint="This creator's record could not be read. Nothing is known about them from this screen — it is not an empty or missing account."
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

  const { profile, creator, standing } = data;
  const isAdmin = identity?.role === 'admin';
  const inReview = creator.vetting_status === 'in_review';

  return (
    <>
      <div className="detail-head">
        <h1 className="page-title">{profile?.full_name || '(no name)'}</h1>
        <Pill status={creator.vetting_status} />
        {creator.verified && <Pill tone="brand">verified</Pill>}
        {creator.vetting_status === 'approved' && !creator.is_available && <Pill tone="neutral">paused</Pill>}

        {isAdmin && inReview && (
          <div className="detail-actions">
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
          </div>
        )}
      </div>
      <p className="page-sub">
        {profile?.email ?? 'no email'} · {profile?.phone ?? 'no phone'}
        {creator.applied_at ? ` · applied ${formatWhen(creator.applied_at)}` : ''} ·{' '}
        <Link to={`/users/${creator.user_id}`}>customer record →</Link>
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', margin: '14px 0' }}>
          {actionError}
        </div>
      )}
      {creator.vetting_status === 'rejected' && creator.rejection_reason && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--warn)', margin: '14px 0' }}>
          Rejected: {creator.rejection_reason}
        </div>
      )}

      {/* The applicant's face and their own work — the two things a reviewer
          actually looks at. These used to be rendered INSIDE the title row's
          flex container, so a 96px photo card sat between the status pills
          and the Approve button. They are their own blocks now. */}
      <div className="t-card" style={{ marginTop: 16 }}>
        <div className="t-card-head">
          <h2>Headshot</h2>
          {creator.headshot_url && (
            <Pill
              tone={
                creator.headshot_status === 'approved'
                  ? 'ok'
                  : creator.headshot_status === 'rejected'
                    ? 'danger'
                    : 'warn'
              }
            >
              {creator.headshot_status ?? 'none'}
            </Pill>
          )}
        </div>
        {creator.headshot_url ? (
          <div className="headshot-card">
            <img src={creator.headshot_url} alt="Creator headshot" />
            <div className="body">
              <div className="note" style={{ marginTop: 0 }}>
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
              <div className="cell-actions">
                <button className="btn" disabled={headshotReview.isPending} onClick={() => headshotReview.mutate(true)}>
                  Approve photo
                </button>
                <button
                  /* was `btn btn-danger`, which has no rule behind it — it
                     rendered as the ordinary yellow primary button */
                  className="btn danger"
                  disabled={headshotReview.isPending}
                  onClick={() =>
                    window.confirm('Reject this headshot? The creator is asked to upload a new one.') &&
                    headshotReview.mutate(false)
                  }
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="lst-inline empty">
            <span>—</span>
            <span>None uploaded — this creator renders as an initial-letter tile in the app.</span>
          </div>
        )}
      </div>

      {creator.portfolio_link && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Portfolio link</h2>
            <span className="meta">their own work — the best evidence for this decision</span>
          </div>
          <a
            href={creator.portfolio_link}
            target="_blank"
            rel="noreferrer noopener"
            style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}
          >
            {creator.portfolio_link}
          </a>
          <div className="meta" style={{ marginTop: 4 }}>Opens in a new tab.</div>
        </div>
      )}

      <div style={{ marginTop: 'var(--gap-grid)' }}>
        <VerificationPanel creatorId={creator.user_id} />
        <NotesThread subjectType="creator" subjectId={creator.user_id} />
      </div>

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Application</h2>
        </div>
        <div className="facts">
          <div>
            <div className="k">Specialties</div>
            <div className="v">{creator.specialties.length ? creator.specialties.join(', ') : '—'}</div>
          </div>
          <div>
            <div className="k">Service type</div>
            <div className="v">{creator.service_type}</div>
          </div>
          <div>
            <div className="k">Base area</div>
            <div className="v">{creator.base_area ?? <span className="quiet">—</span>}</div>
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
          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: '1px solid var(--line)',
              color: 'var(--ink-2)',
              fontSize: 13.5,
            }}
          >
            {creator.bio}
          </div>
        )}
      </div>

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          {/* The tier already appears on the strike-weight tile; saying it
              twice on one card just reads as a stutter. */}
          <h2>Money &amp; standing</h2>
        </div>
        <div className="d-tiles">
          <div className="d-tile">
            <div className="n num">{formatMoney(data.earnings.available)}</div>
            <div className="lab">available / requested</div>
          </div>
          <div className="d-tile">
            <div className="n num">{formatMoney(data.earnings.pending)}</div>
            <div className="lab">pending (in hold)</div>
          </div>
          <div className="d-tile">
            <div className="n num">{formatMoney(data.earnings.paid_out)}</div>
            <div className="lab">paid out lifetime</div>
          </div>
          <div className="d-tile">
            <div className="n num">{data.rating.average != null ? data.rating.average.toFixed(2) : '—'}</div>
            <div className="lab">
              rating · {data.rating.count} review{data.rating.count === 1 ? '' : 's'}
            </div>
          </div>
          <div className="d-tile">
            <div className="n num">{standing.activeWeight}</div>
            <div className="lab">active strike weight ({standing.tierLabel})</div>
          </div>
        </div>
      </div>

      {data.strikes.length > 0 && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Strikes</h2>
            <span className="meta num">{data.strikes.length}</span>
          </div>
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="right">Weight</th>
                  <th>Occurred</th>
                  <th>Standing</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.strikes.map((s) => {
                  const expired = Date.parse(s.expires_at) < Date.now();
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="cell-title">{s.type.replace(/_/g, ' ')}</div>
                        {s.contested && <div className="cell-sub">contested</div>}
                      </td>
                      <td className="right num">{s.weight}</td>
                      <td className="nowrap num">{formatWhen(s.occurred_at)}</td>
                      <td className="nowrap num">
                        {expired ? (
                          <span style={{ color: 'var(--muted)' }}>expired</span>
                        ) : (
                          `active until ${formatWhen(s.expires_at)}`
                        )}
                      </td>
                      <td className="right">
                        <div className="cell-actions">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
        <div className="t-card-head">
          <h2>Recent bookings</h2>
          <span className="meta num">{data.bookings.length}</span>
        </div>
        {data.bookings.length === 0 ? (
          <div className="lst-inline empty">
            <span>—</span>
            <span>No bookings as creator yet.</span>
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
                        {b.occasion ?? b.type} · {b.client_name ?? 'client'}
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

      {data.reviews.length > 0 && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Latest reviews</h2>
            <span className="meta num">{data.reviews.length}</span>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {data.reviews.map((r) => (
              <div key={r.id} className="tl-card">
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="review-stars num">{'★'.repeat(Math.round(Number(r.rating)))}</span>
                  <span className="tl-title">{Number(r.rating).toFixed(1)}</span>
                  <span className="tl-sub">· {r.client_name ?? 'client'}</span>
                  <span className="tl-when" style={{ marginLeft: 'auto' }}>{formatWhen(r.created_at)}</span>
                </div>
                {r.comment && <div className="tl-sub" style={{ marginTop: 4 }}>{r.comment}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.portfolio.length > 0 && (
        <div className="t-card" style={{ marginTop: 'var(--gap-grid)' }}>
          <div className="t-card-head">
            <h2>Portfolio</h2>
            <span className="meta num">{data.portfolio.length}</span>
          </div>
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Caption</th>
                  <th>Uploaded</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.portfolio.map((p) => (
                  <tr key={p.id}>
                    <td><span className="cell-title">{p.caption || '(no caption)'}</span></td>
                    <td className="nowrap num">{formatWhen(p.created_at)}</td>
                    <td className="right">
                      <div className="cell-pills"><Pill tone={portfolioTone(p.status)}>{p.status}</Pill></div>
                    </td>
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
