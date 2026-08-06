import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

interface VerificationData {
  profile: {
    verification_status: string;
    verification_attempts: number;
    police_certificate_path: string | null;
    vetting_decided_by: string | null;
    vetting_decided_at: string | null;
    vetting_agreed_with_didit: boolean | null;
  } | null;
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

          {Array.isArray(latest.warnings) && latest.warnings.length > 0 && (
            <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--warn)', marginTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Warnings from Didit</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {latest.warnings.map((w, i) => (
                  <li key={i}>{typeof w === 'string' ? w : JSON.stringify(w)}</li>
                ))}
              </ul>
            </div>
          )}

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
