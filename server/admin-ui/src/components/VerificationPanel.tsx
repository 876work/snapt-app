import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getToken } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from './ui';

interface Session {
  id: string;
  didit_session_id: string;
  document_type: 'ID' | 'DL' | 'P';
  status: string;
  attempt: number;
  extracted: Record<string, string | null>;
  face_match_score: number | null;
  warnings: unknown[];
  date_of_birth: string | null;
  is_18_plus: boolean | null;
  created_at: string;
  decided_at: string | null;
}

interface Reconciliation {
  verdict: 'match' | 'minor_variance' | 'substantial_mismatch' | 'unknown';
  detail: { reasons?: string[]; compared_with?: string | null; account_name?: string | null };
  review_required: boolean;
  id_name: string | null;
  display_name: string | null;
  declared_legal_name: string | null;
  face_match_score: number | null;
  signal: { level: 'ok' | 'note' | 'caution' | 'alert'; headline: string; detail: string };
  auto_applied: boolean;
}

interface RiskFlag {
  feature: string;
  risk: string;
  description: string;
  duplicate_session_id: string | null;
  duplicate_user_id: string | null;
  duplicate_account?: { id: string; full_name: string; email: string } | null;
}

interface VerificationData {
  profile: {
    verification_status: string;
    verification_attempts: number;
    police_certificate_path: string | null;
    vetting_decided_by: string | null;
    vetting_decided_at: string | null;
    vetting_agreed_with_didit: boolean | null;
    legal_name: string | null;
    legal_name_source: 'didit' | 'admin' | null;
    legal_name_set_at: string | null;
    declared_legal_name: string | null;
  } | null;
  reconciliation: Reconciliation | null;
  risk: { flags: RiskFlag[]; duplicates: RiskFlag[] } | null;
  sessions: Session[];
  image_endpoint: string;
  configured: boolean;
}

const DOC_LABEL: Record<string, string> = {
  ID: 'National ID card',
  DL: "Driver's licence",
  P: 'Passport',
};

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  approved: 'ok',
  in_review: 'warn',
  in_progress: 'warn',
  declined: 'danger',
  failed_underage: 'danger',
  not_started: 'neutral',
};

/**
 * Identity verification review. Didit's result is EVIDENCE for the admin
 * decision, never the decision itself — approve/reject stay enabled
 * whatever it says. Images are streamed from Didit through our server
 * (never copied into our storage), and every view here is audited.
 */
export function VerificationPanel({ creatorId }: { creatorId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['verification', creatorId],
    queryFn: () => api<VerificationData>(`/v1/admin/creators/${creatorId}/verification`),
  });

  if (isLoading) {
    return (
      <div className="section">
        <h2>Identity verification</h2>
        <SectionSkeleton rows={3} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="section">
        <h2>Identity verification</h2>
        <EmptyState glyph="⚠">{(error as Error | undefined)?.message ?? 'Unavailable'}</EmptyState>
      </div>
    );
  }

  const latest = data.sessions[0];
  const status = data.profile?.verification_status ?? 'not_started';

  return (
    <div className="section">
      <h2>
        Identity verification <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Pill>
      </h2>

      {!data.configured && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--warn)', marginBottom: 10 }}>
          Didit isn't configured on this server — applications fall through to manual review.
        </div>
      )}

      {!latest ? (
        <EmptyState glyph="—">
          No verification attempted. Decide from the documents and your own checks.
        </EmptyState>
      ) : (
        <>
          <div className="card kv">
            <div>
              <div className="k">Document</div>
              <div className="v">{DOC_LABEL[latest.document_type] ?? latest.document_type}</div>
            </div>
            <div>
              <div className="k">Didit result</div>
              <div className="v">
                <Pill tone={latest.status === 'Approved' ? 'ok' : latest.status === 'Declined' ? 'danger' : 'warn'}>
                  {latest.status}
                </Pill>
              </div>
            </div>
            <div>
              <div className="k">Face match</div>
              <div className="v num">
                {latest.face_match_score != null ? `${latest.face_match_score.toFixed(1)}%` : '—'}
              </div>
            </div>
            <div>
              <div className="k">Age check</div>
              <div className="v">
                {latest.is_18_plus == null ? (
                  '—'
                ) : latest.is_18_plus ? (
                  <Pill tone="ok">18+ confirmed</Pill>
                ) : (
                  <Pill tone="danger">under 18</Pill>
                )}
                {latest.date_of_birth ? ` · DOB ${latest.date_of_birth}` : ''}
              </div>
            </div>
            <div>
              <div className="k">Attempts</div>
              <div className="v num">
                {data.profile?.verification_attempts ?? latest.attempt} of 2
              </div>
            </div>
            <div>
              <div className="k">Checked</div>
              <div className="v num">{latest.decided_at ? formatWhen(latest.decided_at) : '—'}</div>
            </div>
          </div>

          {data.risk && <RiskPanel risk={data.risk} />}

          {data.reconciliation && (
            <NameReconciliation
              creatorId={creatorId}
              rec={data.reconciliation}
              legalName={data.profile?.legal_name ?? null}
              legalNameSource={data.profile?.legal_name_source ?? null}
            />
          )}

          {Object.values(latest.extracted ?? {}).some(Boolean) && (
            <div className="card kv" style={{ marginTop: 10 }}>
              {Object.entries(latest.extracted)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <div className="k">{k.replace(/_/g, ' ')}</div>
                    <div className="v">{String(v)}</div>
                  </div>
                ))}
            </div>
          )}

          {/* Warnings render in RiskPanel above, resolved to real accounts. */}

          <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            {(['portrait', 'document'] as const).map((kind) => (
              <AuthedImage key={kind} endpoint={data.image_endpoint} kind={kind} />
            ))}
          </div>
          <p className="page-sub" style={{ marginTop: 8 }}>
            Images are streamed from Didit for review and never stored by Snapt. Every view is
            recorded in the audit log.
          </p>
        </>
      )}

      <div className="card kv" style={{ marginTop: 10 }}>
        <div>
          <div className="k">Police certificate</div>
          <div className="v">
            <Pill tone="neutral">Coming soon</Pill> — not required, doesn't block approval
          </div>
        </div>
        {data.profile?.vetting_decided_at && (
          <div>
            <div className="k">Previous decision</div>
            <div className="v">
              {formatWhen(data.profile.vetting_decided_at)}
              {data.profile.vetting_agreed_with_didit == null
                ? ''
                : data.profile.vetting_agreed_with_didit
                  ? ' · agreed with Didit'
                  : ' · overrode Didit'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Duplicate document / face / device across accounts.
 *
 * This is the single strongest fraud signal the verification produces — the
 * same person, or the same borrowed document, appearing under a second
 * account — and it used to be discarded entirely. It sits ABOVE the name and
 * face panel because it changes how you read both.
 */
function RiskPanel({ risk }: { risk: { flags: RiskFlag[]; duplicates: RiskFlag[] } }) {
  if (!risk.flags.length) return null;
  const dupes = risk.duplicates;
  const others = risk.flags.filter((f) => !dupes.includes(f));

  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        padding: 14,
        borderLeft: `4px solid ${dupes.length ? 'var(--danger)' : 'var(--warn)'}`,
      }}
    >
      {dupes.length > 0 ? (
        <>
          <strong style={{ fontSize: 14 }}>
            This identity already appears on {dupes.length === 1 ? 'another account' : 'other accounts'}
          </strong>
          <p style={{ fontSize: 13, lineHeight: '20px', margin: '6px 0 10px', color: 'var(--text-dim)' }}>
            The same document, face or device was used to verify a different account. That is
            legitimate for a shared household device, and the clearest sign of a borrowed or
            sold identity otherwise. Resolve it before approving.
          </p>
          {dupes.map((d, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <Pill tone="danger">{d.risk.replace(/_/g, ' ').toLowerCase()}</Pill>{' '}
              {d.duplicate_account ? (
                <a href={`/users/${d.duplicate_account.id}`}>
                  {d.duplicate_account.full_name || d.duplicate_account.email}
                </a>
              ) : (
                <span style={{ opacity: 0.7 }}>account not resolved</span>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{d.description}</div>
            </div>
          ))}
        </>
      ) : (
        <strong style={{ fontSize: 14 }}>Checks raised {risk.flags.length} note(s)</strong>
      )}
      {others.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
          {others.map((f, i) => (
            <li key={i}>
              <strong>{f.risk.replace(/_/g, ' ').toLowerCase()}</strong> — {f.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const VERDICT_LABEL: Record<string, string> = {
  match: 'Names match',
  minor_variance: 'Minor variance',
  substantial_mismatch: 'Substantial mismatch',
  unknown: 'Could not compare',
};

const SIGNAL_COLOUR: Record<string, string> = {
  ok: 'var(--ok)',
  note: 'var(--gold, #C9A227)',
  caution: 'var(--warn)',
  alert: 'var(--danger)',
};

/**
 * ID name against account name, read TOGETHER with the face match.
 *
 * Two separate numbers make an admin do the correlation in their head, and
 * the correlation is the whole point: a different name with a strong face
 * match is usually a nickname, while the same difference with a weak face
 * match is what a borrowed document looks like. So the combined verdict is
 * the headline and the raw numbers sit underneath it.
 */
function NameReconciliation({
  creatorId,
  rec,
  legalName,
  legalNameSource,
}: {
  creatorId: string;
  rec: Reconciliation;
  legalName: string | null;
  legalNameSource: 'didit' | 'admin' | null;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (action: 'accept_id_name' | 'keep_display_name') =>
      api(`/v1/admin/creators/${creatorId}/legal-name`, {
        method: 'POST',
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['verification', creatorId] });
      qc.invalidateQueries({ queryKey: ['creator', creatorId] });
    },
  });

  const blocked = rec.verdict === 'substantial_mismatch';
  const reasons = rec.detail?.reasons ?? [];

  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        padding: 14,
        borderLeft: `4px solid ${SIGNAL_COLOUR[rec.signal.level] ?? 'var(--border)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>{rec.signal.headline}</strong>
        <Pill
          tone={
            rec.verdict === 'match' ? 'ok' : rec.verdict === 'minor_variance' ? 'warn' : 'danger'
          }
        >
          {VERDICT_LABEL[rec.verdict]}
        </Pill>
        <Pill tone="neutral">
          face {rec.face_match_score != null ? `${rec.face_match_score.toFixed(1)}%` : '—'}
        </Pill>
      </div>
      <p style={{ fontSize: 13, lineHeight: '20px', margin: '8px 0 0', color: 'var(--text-dim)' }}>
        {rec.signal.detail}
      </p>

      <div className="kv" style={{ marginTop: 12 }}>
        <div>
          <div className="k">Name on the ID</div>
          <div className="v">{rec.id_name ?? '—'}</div>
        </div>
        <div>
          <div className="k">Name clients see</div>
          <div className="v">{rec.display_name ?? '—'}</div>
        </div>
        <div>
          <div className="k">Legal name they declared</div>
          <div className="v">{rec.declared_legal_name ?? <span style={{ opacity: 0.6 }}>not given</span>}</div>
        </div>
        <div>
          <div className="k">Verified legal name</div>
          <div className="v">
            {legalName ? (
              <>
                {legalName}{' '}
                <Pill tone="neutral">
                  {legalNameSource === 'admin' ? 'set by admin' : 'from ID'}
                </Pill>
              </>
            ) : (
              <span style={{ opacity: 0.6 }}>not set</span>
            )}
          </div>
        </div>
      </div>

      {reasons.length > 0 && (
        <p style={{ fontSize: 12.5, margin: '10px 0 0', color: 'var(--text-dim)' }}>
          Matched after: {reasons.join(', ')}
          {rec.detail?.compared_with
            ? ` · compared with the ${rec.detail.compared_with.replace(/_/g, ' ')}`
            : ''}
        </p>
      )}

      {blocked ? (
        <>
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              background: 'var(--bg)',
              fontSize: 12.5,
              lineHeight: '19px',
            }}
          >
            <strong>Nothing has been applied to this account.</strong> A substantial mismatch is
            never written automatically — the discrepancy is evidence, and overwriting it would
            destroy it. The display name is untouched either way.
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why you're deciding this way (recorded in the audit log)"
            style={{ marginTop: 10, width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              disabled={decide.isPending || !rec.id_name}
              onClick={() => decide.mutate('accept_id_name')}
            >
              Accept the ID name as legal name
            </button>
            <button
              className="btn"
              disabled={decide.isPending}
              onClick={() => decide.mutate('keep_display_name')}
            >
              Leave it — keep display name only
            </button>
          </div>
          <p className="page-sub" style={{ marginTop: 8 }}>
            To turn the application down, use Reject on the application itself — a name query
            isn't automatically a rejection.
          </p>
        </>
      ) : (
        <p className="page-sub" style={{ marginTop: 10 }}>
          {rec.auto_applied
            ? 'Applied automatically as the verified legal name. The display name was not changed, and the creator has been emailed.'
            : 'No legal name has been set from this session.'}
        </p>
      )}
      {decide.isError && (
        <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>
          {(decide.error as Error).message}
        </p>
      )}
    </div>
  );
}

/**
 * Verification images require the admin bearer token, and a token must never
 * ride in a URL — so fetch as a blob and render from an object URL.
 */
function AuthedImage({ endpoint, kind }: { endpoint: string; kind: 'portrait' | 'document' }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${endpoint}?kind=${kind}`, {
          headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint, kind]);

  if (failed) return null;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="k" style={{ marginBottom: 6 }}>
        {kind === 'portrait' ? 'Selfie' : 'Document'}
      </div>
      {src ? (
        <img
          src={src}
          alt={kind === 'portrait' ? 'Verification selfie' : 'Verification document'}
          style={{ width: 190, height: 140, objectFit: 'cover', borderRadius: 10, background: 'var(--bg)' }}
        />
      ) : (
        <div style={{ width: 190, height: 140, borderRadius: 10, background: 'var(--bg)' }} />
      )}
    </div>
  );
}
