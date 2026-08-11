import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Pill } from '../components/ui';

/**
 * Promotional sends, through the same pipeline as everything else.
 *
 * A Firebase console send bypasses our server, so it can never write an inbox
 * record — which is precisely why those never showed up in the app. Sending
 * from here writes the inbox rows first, then pushes.
 *
 * Opted-out users are excluded from the audience before anything is written,
 * so they get no record AND no push.
 */
const AUDIENCES = [
  { key: 'all', label: 'Everyone', hint: 'All active accounts who allow promotions' },
  { key: 'clients', label: 'Clients only', hint: 'Accounts that are not approved creators' },
  { key: 'creators', label: 'Creators only', hint: 'Approved creators' },
];

export function Promotions() {
  const [audience, setAudience] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<{ recipients: number; pushed: number } | null>(null);

  const preview = useQuery({
    queryKey: ['promo-audience', audience],
    queryFn: () => api<{ total: number; with_push: number }>(`/v1/admin/promotions/audience?audience=${audience}`),
  });

  const send = useMutation({
    mutationFn: () =>
      api<{ recipients: number; pushed: number }>('/v1/admin/promotions/send', {
        method: 'POST',
        body: JSON.stringify({ audience, title: title.trim(), body: body.trim(), deep_link: deepLink.trim() || undefined }),
      }),
    onSuccess: (r) => {
      setSent({ recipients: r.recipients, pushed: r.pushed });
      setConfirming(false);
      setTitle('');
      setBody('');
      setDeepLink('');
    },
  });

  const ready = title.trim().length > 2 && body.trim().length > 2;

  return (
    <>
      <h1 className="page-title">Promotions</h1>
      <p className="page-sub">
        Sends through Snapt's own pipeline: every recipient gets an inbox record first, then a push.
        Anyone who has turned promotions off is excluded before anything is written.
      </p>

      {sent && (
        <div className="card" style={{ padding: 14, borderLeft: '4px solid var(--ok)', margin: '16px 0' }}>
          <strong>Sent.</strong> {sent.recipients} inbox records written, {sent.pushed} devices reached.
          The difference is people without a registered device — they'll see it in the app.
        </div>
      )}

      <div className="section">
        <h2>Audience</h2>
        <div className="t-card">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {AUDIENCES.map((a) => (
              <button
                key={a.key}
                /* `primary` has no rule behind it, so all three rendered as
                   the same solid yellow and the chosen audience was invisible.
                   Selected stays solid; the rest go ghost. */
                className={`btn ${audience === a.key ? '' : 'ghost'}`}
                onClick={() => setAudience(a.key)}
                title={a.hint}
              >
                {a.label}
              </button>
            ))}
          </div>
          {/* The count decides who this reaches, so a failed count must not
              read like a quiet aside in the same grey as a successful one. */}
          <div style={{ marginTop: 14 }}>
            {/* Order matters: between retry attempts react-query reports
                neither loading nor error while `data` is still undefined, so
                testing `isLoading` first dropped through to the success branch
                and threw on `data.total`. Error first, then data, else
                loading — the only order with no undefined window. */}
            {preview.isError ? (
              <div className="lst-inline failed" role="alert">
                <span>⚠</span>
                <span>
                  Couldn't count the audience — {(preview.error as Error).message}. The number of
                  people this would reach is unknown, not zero.{' '}
                  <button
                    className="btn danger"
                    style={{ marginLeft: 6, padding: '4px 10px' }}
                    onClick={() => preview.refetch()}
                  >
                    Try again
                  </button>
                </span>
              </div>
            ) : preview.data ? (
              <p className="page-sub" style={{ margin: 0 }}>
                <Pill tone="neutral">{preview.data.total} recipients</Pill>{' '}
                <Pill tone="neutral">{preview.data.with_push} with a device</Pill> — opt-outs,
                suspended and deleted accounts already excluded.
              </p>
            ) : (
              <div className="lst-inline empty">
                <span>◍</span>
                <span>Counting the audience…</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Message</h2>
        <div className="t-card">
        {/* These three carried `.k`, which is only styled inside a `.kv` grid,
            and no `.input` — so they rendered as raw browser controls in the
            middle of the card treatment. */}
        <label className="field-label" htmlFor="promo-title">Title</label>
        <input
          id="promo-title"
          className="input"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Golden hour weekends"
          style={{ width: '100%', marginBottom: 12 }}
        />
        <label className="field-label" htmlFor="promo-body">Body</label>
        <textarea
          id="promo-body"
          className="input"
          value={body}
          rows={3}
          maxLength={240}
          onChange={(e) => setBody(e.target.value)}
          placeholder="10% off sunset sessions this month."
          style={{ width: '100%', marginBottom: 12, resize: 'vertical' }}
        />
        <label className="field-label" htmlFor="promo-link">Deep link (optional)</label>
        <input
          id="promo-link"
          className="input"
          value={deepLink}
          onChange={(e) => setDeepLink(e.target.value)}
          placeholder="/(app)/booking/occasion"
          style={{ width: '100%' }}
        />
        <p className="page-sub" style={{ marginTop: 6 }}>
          Where tapping the notification lands. Leave blank and it just opens the inbox.
        </p>
        </div>
      </div>

      {!confirming ? (
        <button className="btn primary" disabled={!ready} onClick={() => setConfirming(true)}>
          Review and send
        </button>
      ) : (
        <div className="card" style={{ padding: 14, borderLeft: '4px solid var(--warn)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Send “{title}” to {preview.data?.total ?? '…'} people?
          </div>
          <p className="page-sub" style={{ marginTop: 0 }}>
            This writes an inbox record for every recipient and cannot be recalled.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn primary" disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? 'Sending…' : 'Send now'}
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      )}
      {send.isError && (
        <p style={{ color: 'var(--danger)', marginTop: 10 }}>{(send.error as Error).message}</p>
      )}
    </>
  );
}
