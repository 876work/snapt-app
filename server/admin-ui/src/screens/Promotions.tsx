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
        <div className="card" style={{ padding: 14, borderLeft: '4px solid var(--ok)', marginBottom: 14 }}>
          <strong>Sent.</strong> {sent.recipients} inbox records written, {sent.pushed} devices reached.
          The difference is people without a registered device — they'll see it in the app.
        </div>
      )}

      <div className="section">
        <h2>Audience</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {AUDIENCES.map((a) => (
            <button
              key={a.key}
              className={`btn ${audience === a.key ? 'primary' : ''}`}
              onClick={() => setAudience(a.key)}
              title={a.hint}
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className="page-sub" style={{ marginTop: 10 }}>
          {preview.isLoading ? (
            'Counting…'
          ) : preview.data ? (
            <>
              <Pill tone="neutral">{preview.data.total} recipients</Pill>{' '}
              <Pill tone="neutral">{preview.data.with_push} with a device</Pill> — opt-outs, suspended
              and deleted accounts already excluded.
            </>
          ) : (
            'Could not count the audience.'
          )}
        </p>
      </div>

      <div className="section">
        <h2>Message</h2>
        <label className="k" htmlFor="promo-title">Title</label>
        <input
          id="promo-title"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Golden hour weekends"
          style={{ width: '100%', marginBottom: 10 }}
        />
        <label className="k" htmlFor="promo-body">Body</label>
        <textarea
          id="promo-body"
          value={body}
          rows={3}
          maxLength={240}
          onChange={(e) => setBody(e.target.value)}
          placeholder="10% off sunset sessions this month."
          style={{ width: '100%', marginBottom: 10 }}
        />
        <label className="k" htmlFor="promo-link">Deep link (optional)</label>
        <input
          id="promo-link"
          value={deepLink}
          onChange={(e) => setDeepLink(e.target.value)}
          placeholder="/(app)/booking/occasion"
          style={{ width: '100%' }}
        />
        <p className="page-sub" style={{ marginTop: 6 }}>
          Where tapping the notification lands. Leave blank and it just opens the inbox.
        </p>
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
