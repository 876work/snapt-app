import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';

interface ConfigRow {
  key: string;
  value: unknown;
  description: string;
  confirmed: boolean;
  updated_at: string;
}

export function Config() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ config: ConfigRow[] }>('/v1/admin/config'),
  });

  const update = useMutation({
    mutationFn: (vars: { key: string; value?: unknown; confirmed?: boolean }) =>
      api(`/v1/admin/config/${encodeURIComponent(vars.key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: vars.value, confirmed: vars.confirmed }),
      }),
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError((e as Error).message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const rows = (data?.config ?? []).filter(
    (r) =>
      !term ||
      r.key.toLowerCase().includes(term.toLowerCase()) ||
      r.description.toLowerCase().includes(term.toLowerCase()),
  );
  const unconfirmed = (data?.config ?? []).filter((r) => !r.confirmed).length;

  const editValue = (r: ConfigRow) => {
    const current = JSON.stringify(r.value);
    const next = window.prompt(
      `${r.key}\n${r.description || 'No description.'}\n\nNew value (JSON — quotes for strings, plain numbers/booleans as-is):`,
      current,
    );
    if (next == null || next === current) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch {
      setActionError(`Not valid JSON: ${next}`);
      return;
    }
    if (window.confirm(`Set ${r.key} = ${next}?\n\nThis takes effect immediately for pricing/logic that reads it.`))
      update.mutate({ key: r.key, value: parsed });
  };

  return (
    <>
      <h1 className="page-title">Config</h1>
      <p className="page-sub">
        Every business number the server reads — fees, windows, rates, kill switches. Unconfirmed
        means “working default, do not rely on it until confirmed”{unconfirmed ? ` (${unconfirmed} to review)` : ''}.
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      <div className="toolbar">
        <input
          className="input"
          placeholder="Filter keys…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Filter config keys"
        />
      </div>

      {isLoading ? (
        <SectionSkeleton rows={8} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState glyph="—">No keys match.</EmptyState>
      ) : (
        <div className="card row-list">
          {rows.map((r) => (
            <div key={r.key} className="row">
              <div className="who grow">
                <div className="name num">{r.key}</div>
                <div className="sub">
                  {r.description || 'No description'} · updated {formatWhen(r.updated_at)}
                </div>
              </div>
              <span className="num" style={{ fontWeight: 700, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {JSON.stringify(r.value)}
              </span>
              {r.confirmed ? (
                <Pill tone="ok">confirmed</Pill>
              ) : (
                <button
                  className="btn ghost"
                  disabled={update.isPending}
                  onClick={() => {
                    if (window.confirm(`Confirm ${r.key} = ${JSON.stringify(r.value)} as the real business value?`))
                      update.mutate({ key: r.key, confirmed: true });
                  }}
                >
                  Confirm
                </button>
              )}
              <button className="btn ghost" disabled={update.isPending} onClick={() => editValue(r)}>
                Edit
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
