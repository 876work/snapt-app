import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Pill, SectionSkeleton, formatMoney, formatWhen, useNow, formatDuration } from '../components/ui';

interface Dispute {
  id: string;
  booking_id: string;
  category: string;
  status: string;
  description: string;
  evidence_deadline_at: string | null;
  created_at: string;
  opened_by_name: string | null;
  dispute_evidence: { id: string; kind: string; content: string; created_at: string; submitted_by_name: string | null }[];
  booking: {
    occasion: string | null;
    type: string;
    area: string | null;
    scheduled_at: string | null;
    price_usd: number;
    client_id: string;
    creator_id: string | null;
    client_name: string | null;
    creator_name: string | null;
  } | null;
}

export function Disputes() {
  const now = useNow(30_000);
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['disputes'],
    queryFn: () => api<{ disputes: Dispute[] }>('/v1/admin/disputes'),
    refetchInterval: 60_000,
  });

  const resolve = useMutation({
    mutationFn: (vars: { id: string; resolution: string; release_payout: boolean }) =>
      api(`/v1/admin/disputes/${vars.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution: vars.resolution, release_payout: vars.release_payout }),
      }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['disputes'] }),
  });

  const isAdmin = identity?.role === 'admin';
  const rows = data?.disputes ?? [];

  return (
    <>
      <h1 className="page-title">Disputes</h1>
      <p className="page-sub">
        Open cases, oldest first. Resolving decides the frozen payout: release it to the creator, or
        withhold it. Both parties are notified.
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      {isLoading ? (
        <SectionSkeleton rows={4} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState glyph="✓">No open disputes.</EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((d) => {
            const deadline = d.evidence_deadline_at ? Date.parse(d.evidence_deadline_at) : null;
            const windowOpen = deadline != null && deadline > now;
            const expanded = open === d.id;
            return (
              <div key={d.id} className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }}
                  onClick={() => setOpen(expanded ? null : d.id)}
                >
                  <div className="grow" style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 700 }}>
                      {d.category.replace(/_/g, ' ')} · opened by {d.opened_by_name ?? 'user'} · {formatWhen(d.created_at)}
                    </div>
                    <div className="sub" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                      {d.booking
                        ? `${d.booking.occasion ?? d.booking.type} · ${d.booking.client_name ?? 'client'}${
                            d.booking.creator_name ? ` → ${d.booking.creator_name}` : ''
                          } · ${formatMoney(Number(d.booking.price_usd))}`
                        : `booking ${d.booking_id.slice(0, 8)}`}
                    </div>
                  </div>
                  {windowOpen && <Pill tone="warn">evidence window: {formatDuration(deadline! - now)} left</Pill>}
                  <Pill status={d.status} />
                </div>

                {expanded && (
                  <>
                    {d.description && <div style={{ fontSize: 13.5 }}>{d.description}</div>}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                        Evidence ({d.dispute_evidence.length})
                      </div>
                      {d.dispute_evidence.length === 0 ? (
                        <div className="sub" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                          None submitted{windowOpen ? ' yet — window still open' : ''}.
                        </div>
                      ) : (
                        <div className="row-list" style={{ display: 'grid', gap: 8 }}>
                          {d.dispute_evidence.map((e) => (
                            <div key={e.id} style={{ fontSize: 12.5, borderLeft: '3px solid var(--line)', paddingLeft: 10 }}>
                              <span style={{ fontWeight: 600 }}>{e.submitted_by_name ?? 'party'}</span>{' '}
                              <span style={{ color: 'var(--muted)' }}>{formatWhen(e.created_at)}</span>
                              <div>{e.kind === 'text' ? e.content : `[${e.kind}] ${e.content}`}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link className="btn ghost" to={`/bookings/${d.booking_id}`}>
                        Open booking
                      </Link>
                      {isAdmin && (
                        <>
                          <button
                            className="btn"
                            disabled={resolve.isPending}
                            onClick={() => {
                              const resolution = window.prompt(
                                'Resolution — in favour of the CREATOR (payout released). Summarise the outcome for the record:',
                              );
                              if (resolution?.trim())
                                resolve.mutate({ id: d.id, resolution: resolution.trim(), release_payout: true });
                            }}
                          >
                            Resolve — release payout
                          </button>
                          <button
                            className="btn danger"
                            disabled={resolve.isPending}
                            onClick={() => {
                              const resolution = window.prompt(
                                'Resolution — in favour of the CLIENT (payout stays withheld). Summarise the outcome for the record:',
                              );
                              if (resolution?.trim())
                                resolve.mutate({ id: d.id, resolution: resolution.trim(), release_payout: false });
                            }}
                          >
                            Resolve — withhold payout
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
