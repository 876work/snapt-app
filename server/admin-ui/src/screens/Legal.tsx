import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';

interface PolicyRow {
  id: string;
  doc_type: string;
  version: number;
  title: string;
  // 'archived' has always existed in the policy_doc_status enum; this type
  // simply never modelled it, so an archived row rendered as an unrecognised
  // status. Live rows are draft/published; superseded ones are archived.
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  requires_reconsent: boolean;
  created_at: string;
}

interface FullPolicy extends PolicyRow {
  content: string;
}

export function Legal() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    slug: string;
    title: string;
    content: string;
    requires_reconsent: boolean;
    baseVersion: number | null;
  } | null>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['policies'],
    queryFn: () => api<{ policies: PolicyRow[] }>('/v1/admin/policies'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['policies'] });
  const draft = useMutation({
    mutationFn: (vars: { slug: string; title: string; content: string; requires_reconsent: boolean }) =>
      api(`/v1/admin/policies/${vars.slug}`, {
        method: 'POST',
        body: JSON.stringify({ title: vars.title, content: vars.content, requires_reconsent: vars.requires_reconsent }),
      }),
    onSuccess: () => {
      setActionError(null);
      setEditing(null);
    },
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });
  const publish = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/policies/${id}/publish`, { method: 'POST' }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: refresh,
  });

  // Group by doc type: latest version first within each.
  const allTypes = new Map<string, PolicyRow[]>();
  for (const p of data?.policies ?? []) {
    allTypes.set(p.doc_type, [...(allTypes.get(p.doc_type) ?? []), p]);
  }
  /**
   * The 2026-08-13 consolidation left nine doc types with nothing but
   * archived rows. They are kept — consent records point at them — but a CMS
   * listing thirteen policies when four are live is the confusion the
   * consolidation existed to remove. Live types are listed; retired ones
   * collapse into a muted note that still names them.
   */
  const byType = new Map<string, PolicyRow[]>();
  const retired: string[] = [];
  for (const [slug, versions] of allTypes) {
    if (versions.some((v) => v.status !== 'archived')) byType.set(slug, versions);
    else retired.push(slug);
  }

  const startDraft = async (slug: string, from: PolicyRow | null) => {
    setLoadingEditor(true);
    try {
      let content = '';
      let title = from?.title ?? slug;
      if (from) {
        const res = await api<{ policy: FullPolicy }>(`/v1/admin/policies/${from.id}`);
        content = res.policy.content;
        title = res.policy.title;
      }
      setEditing({ slug, title, content, requires_reconsent: false, baseVersion: from?.version ?? null });
      setActionError(null);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setLoadingEditor(false);
    }
  };

  if (editing) {
    return (
      <>
        <h1 className="page-title">
          {editing.slug} — draft v{(editing.baseVersion ?? 0) + 1}
        </h1>
        <p className="page-sub">
          Saves as a DRAFT — nothing reaches users until you publish. Publishing a material change
          with the re-consent flag forces every approved creator to re-accept before continuing.
        </p>
        {actionError && (
          <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
            {actionError}
          </div>
        )}
        <div className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600 }}>
            Title
            <input
              className="input"
              style={{ display: 'block', width: '100%', marginTop: 5 }}
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 600 }}>
            Content
            <textarea
              className="input"
              style={{ display: 'block', width: '100%', marginTop: 5, minHeight: 320, fontFamily: 'inherit', resize: 'vertical' }}
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={editing.requires_reconsent}
              onChange={(e) => setEditing({ ...editing, requires_reconsent: e.target.checked })}
            />
            Material change — require re-consent from approved creators on publish
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              disabled={draft.isPending || !editing.content.trim()}
              onClick={() => draft.mutate(editing)}
            >
              Save draft
            </button>
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Discard
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Legal</h1>
      <p className="page-sub">
        Policy documents, versioned. Drafts need review before publishing; the re-consent flag on a
        published version is what forces creators to re-accept material changes.
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      {isLoading ? (
        <SectionSkeleton rows={6} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : byType.size === 0 ? (
        <EmptyState glyph="—">No policy documents yet.</EmptyState>
      ) : (
        [...byType.entries()].map(([slug, versions]) => {
          const latest = versions[0];
          return (
            <div className="section" key={slug}>
              <h2>
                {latest.title || slug}
                <span className="count num">{slug}</span>
              </h2>
              <div className="card row-list">
                {versions.map((p) => (
                  <div key={p.id} className="row">
                    <div className="who grow">
                      <div className="name num">v{p.version}</div>
                      <div className="sub">
                        {p.status === 'published'
                          ? `published ${p.published_at ? formatWhen(p.published_at) : ''}`
                          : `drafted ${formatWhen(p.created_at)}`}
                      </div>
                    </div>
                    {p.requires_reconsent && <Pill tone="warn">re-consent</Pill>}
                    <Pill tone={p.status === 'published' ? 'ok' : 'neutral'}>{p.status}</Pill>
                    {p.status === 'draft' && (
                      <button
                        className="btn"
                        disabled={publish.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Publish ${slug} v${p.version}?${
                                p.requires_reconsent
                                  ? '\n\nThis is flagged as a MATERIAL CHANGE — every approved creator must re-accept before continuing.'
                                  : ''
                              }`,
                            )
                          )
                            publish.mutate(p.id);
                        }}
                      >
                        Publish
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="btn ghost" disabled={loadingEditor} onClick={() => startDraft(slug, latest)}>
                  Draft new version
                </button>
              </div>
            </div>
          );
        })
      )}

      {retired.length > 0 && (
        /* Archived, never deleted — consent records reference these rows. */
        <p className="muted" style={{ marginTop: 18, fontSize: 12 }}>
          {retired.length} policy {retired.length === 1 ? 'type is' : 'types are'} retired and fully
          archived after the consolidation: {retired.join(', ')}. Their versions are kept for the
          consent records that reference them.
        </p>
      )}
    </>
  );
}
