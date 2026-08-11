import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';
import {
  CONFIG_SCHEMA,
  GROUPS,
  fromPercent,
  toPercent,
  type ControlSpec,
  type GroupId,
  type KeySpec,
} from '../config-schema';

/**
 * Every setting used to be edited the same way: window.prompt() containing
 * raw JSON, whatever the value actually was. Editing strike_tiers meant
 * hand-typing a JSON array and one missing quote broke it. This screen gives
 * each key the control its type deserves, driven by config-schema.ts.
 *
 * Three rules it follows throughout:
 *   - the current value is shown in full, never truncated with "…";
 *   - nothing is written until the change has been shown back and confirmed;
 *   - a value that would break a documented invariant is REFUSED with a
 *     sentence, not warned about and written anyway.
 */

interface ConfigRow {
  key: string;
  value: unknown;
  description: string;
  confirmed: boolean;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Rendering a value as something a person reads, per type.
// ---------------------------------------------------------------------------

function displayValue(spec: KeySpec | undefined, value: unknown): string {
  const c = spec?.control;
  if (c?.kind === 'percent' && typeof value === 'number') return `${toPercent(value)}%`;
  if (c?.kind === 'number' && typeof value === 'number') return `${value} ${c.unit}`;
  if (c?.kind === 'boolean' && typeof value === 'boolean') {
    return value ? (c.onLabel ?? 'On') : (c.offLabel ?? 'Off');
  }
  if (c?.kind === 'string-list' && Array.isArray(value)) {
    return value
      .map((v, i) => {
        const label = c.options.find((o) => o.value === v)?.label ?? String(v);
        return c.ordered && c.positionLabel ? `${c.positionLabel(i)}: ${label}` : label;
      })
      .join(' · ');
  }
  if (c?.kind === 'fields' && value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return c.fields
      .map((f) => {
        const raw = v[f.name];
        const shown = f.percent && typeof raw === 'number' ? `${toPercent(raw)}%` : `${raw} ${f.unit}`;
        return `${f.label}: ${shown}`;
      })
      .join(' · ');
  }
  return JSON.stringify(value, null, value && typeof value === 'object' ? 2 : 0) ?? '—';
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function NumberInput({
  value,
  unit,
  min,
  max,
  integer,
  step,
  onChange,
}: {
  value: number | '';
  unit: string;
  min: number;
  max: number;
  integer?: boolean;
  step?: number;
  onChange: (v: number | '') => void;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <input
        className="input num"
        type="number"
        style={{ width: 130 }}
        value={value}
        min={min}
        max={max}
        step={step ?? (integer ? 1 : 'any')}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
      <span className="sub" style={{ whiteSpace: 'nowrap' }}>{unit}</span>
      <span className="sub" style={{ opacity: 0.65, whiteSpace: 'nowrap' }}>
        ({min}–{max})
      </span>
    </label>
  );
}

/** Ordered list with add / remove / reorder, choosing from known options. */
function StringListEditor({
  spec,
  value,
  onChange,
}: {
  spec: Extract<ControlSpec, { kind: 'string-list' }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [toAdd, setToAdd] = useState(spec.options[0]?.value ?? '');
  const move = (i: number, delta: number) => {
    const next = [...value];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {value.map((v, i) => (
        <div key={`${v}-${i}`} className="row" style={{ padding: '8px 10px', gap: 10 }}>
          {spec.ordered && spec.positionLabel && (
            <span className="pill" style={{ minWidth: 78, justifyContent: 'center' }}>
              {spec.positionLabel(i)}
            </span>
          )}
          <select
            className="input grow"
            value={v}
            onChange={(e) => {
              const next = [...value];
              next[i] = e.target.value;
              onChange(next);
            }}
          >
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {!spec.options.some((o) => o.value === v) && <option value={v}>{v} (unknown)</option>}
          </select>
          <button className="btn ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button className="btn ghost" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button className="btn ghost" onClick={() => onChange(value.filter((_, k) => k !== i))}>Remove</button>
        </div>
      ))}
      {(spec.max == null || value.length < spec.max) && (
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="input grow" value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn ghost" onClick={() => toAdd && onChange([...value, toAdd])}>Add</button>
        </div>
      )}
    </div>
  );
}

function MatrixEditor({
  spec,
  value,
  onChange,
}: {
  spec: Extract<ControlSpec, { kind: 'matrix' }>;
  value: Record<string, Record<string, number>>;
  onChange: (v: Record<string, Record<string, number>>) => void;
}) {
  const rows = Object.keys(value);
  // Column order is numeric where the keys are numbers (durations), else as
  // stored — a price grid that reshuffles itself is unreadable.
  const cols = useMemo(() => {
    const all = new Set<string>();
    for (const r of rows) for (const c of Object.keys(value[r] ?? {})) all.add(c);
    const list = [...all];
    return list.every((c) => !Number.isNaN(Number(c)))
      ? list.sort((a, b) => Number(a) - Number(b))
      : list;
  }, [rows, value]);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
        <thead>
          <tr>
            <th className="sub" style={{ textAlign: 'left', padding: '4px 10px 8px 0' }}>{spec.colLabel} →</th>
            {cols.map((c) => (
              <th key={c} className="sub" style={{ padding: '4px 8px 8px', textAlign: 'left' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td className="num" style={{ fontWeight: 700, paddingRight: 12 }}>{r}</td>
              {cols.map((c) => (
                <td key={c} style={{ padding: '3px 6px 3px 0' }}>
                  <input
                    className="input num"
                    type="number"
                    style={{ width: 92 }}
                    min={spec.min}
                    max={spec.max}
                    value={value[r]?.[c] ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        [r]: { ...value[r], [c]: e.target.value === '' ? NaN : Number(e.target.value) },
                      })
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sub" style={{ marginTop: 6 }}>All prices in {spec.unit}.</div>
    </div>
  );
}

function RecordsEditor({
  spec,
  value,
  onChange,
}: {
  spec: Extract<ControlSpec, { kind: 'records' }>;
  value: Record<string, unknown>[];
  onChange: (v: Record<string, unknown>[]) => void;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 560 }}>
        <thead>
          <tr>
            {spec.columns.map((c) => (
              <th key={c.name} className="sub" style={{ textAlign: 'left', padding: '4px 8px 8px 0' }}>
                {c.label}
                {c.unit ? ` (${c.unit})` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {spec.columns.map((c) => (
                <td key={c.name} style={{ padding: '3px 8px 3px 0' }}>
                  <input
                    className={`input${c.type === 'number' ? ' num' : ''}`}
                    type={c.type === 'number' ? 'number' : 'text'}
                    style={{ width: c.type === 'number' ? 96 : 130 }}
                    readOnly={c.readOnly}
                    disabled={c.readOnly}
                    min={c.min}
                    max={c.max}
                    step={c.integer ? 1 : 'any'}
                    value={(row[c.name] as string | number | undefined) ?? ''}
                    onChange={(e) => {
                      const next = [...value];
                      next[i] = {
                        ...row,
                        [c.name]: c.type === 'number' ? (e.target.value === '' ? NaN : Number(e.target.value)) : e.target.value,
                      };
                      onChange(next);
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation — bounds and shape. Cross-key invariants are enforced by the
// server as well; these exist so the admin gets a sentence before the round
// trip, not instead of the server's guarantee.
// ---------------------------------------------------------------------------

function validate(key: string, spec: KeySpec, next: unknown): string | null {
  const c = spec.control;
  const numberIn = (v: unknown, min: number, max: number, unit: string, integer?: boolean, label?: string): string | null => {
    if (typeof v !== 'number' || Number.isNaN(v)) return `${label ?? 'Value'} must be a number.`;
    if (integer && !Number.isInteger(v)) return `${label ?? 'Value'} must be a whole number of ${unit}.`;
    if (v < min || v > max) return `${label ?? 'Value'} must be between ${min} and ${max} ${unit}. You entered ${v}.`;
    return null;
  };

  if (c.kind === 'number') return numberIn(next, c.min, c.max, c.unit, c.integer, spec.title);
  if (c.kind === 'percent') {
    if (typeof next !== 'number' || Number.isNaN(next)) return `${spec.title} must be a number.`;
    const pct = toPercent(next);
    if (pct < c.min || pct > c.max) return `${spec.title} must be between ${c.min}% and ${c.max}%. You entered ${pct}%.`;
    return null;
  }
  if (c.kind === 'boolean') return typeof next === 'boolean' ? null : 'Must be on or off.';
  if (c.kind === 'string-list') {
    if (!Array.isArray(next) || next.length === 0) return `${spec.title} needs at least one entry.`;
    const unknown = next.find((v) => !c.options.some((o) => o.value === v));
    if (unknown) return `"${unknown}" is not one of the known options.`;
    return null;
  }
  if (c.kind === 'fields') {
    if (!next || typeof next !== 'object') return 'Expected a set of values.';
    const v = next as Record<string, unknown>;
    for (const f of c.fields) {
      const raw = v[f.name];
      const shown = f.percent && typeof raw === 'number' ? toPercent(raw) : raw;
      const err = numberIn(shown, f.min, f.max, f.unit, f.integer, f.label);
      if (err) return err;
    }
    if (key === 'delivery_windows') {
      const std = Number(v.standard_hours);
      const rush = Number(v.rush_hours);
      if (rush >= std) return `Rush delivery (${rush}h) must be faster than standard delivery (${std}h).`;
    }
    if (key === 'cancel_tiers') {
      const a = toPercent(Number(v.over48h));
      const b = toPercent(Number(v.between24and48h));
      const d = toPercent(Number(v.under24h));
      if (!(a <= b && b <= d)) {
        return `Cancelling later cannot cost less. Right now: over 48h ${a}%, 24–48h ${b}%, under 24h ${d}%.`;
      }
    }
    return null;
  }
  if (c.kind === 'matrix') {
    const v = next as Record<string, Record<string, number>>;
    for (const [row, cols] of Object.entries(v)) {
      for (const [col, n] of Object.entries(cols)) {
        const err = numberIn(n, c.min, c.max, c.unit, false, `${row} / ${col}`);
        if (err) return err;
      }
    }
    return null;
  }
  if (c.kind === 'records') {
    const v = next as Record<string, unknown>[];
    for (const row of v) {
      for (const col of c.columns) {
        if (col.readOnly) continue;
        if (col.type === 'number') {
          const err = numberIn(row[col.name], col.min ?? 0, col.max ?? Number.MAX_SAFE_INTEGER, col.unit ?? '', col.integer, `${row.id} — ${col.label}`);
          if (err) return err;
        } else if (!String(row[col.name] ?? '').trim()) {
          return `${row.id} — ${col.label} cannot be empty.`;
        }
      }
    }
    return null;
  }
  if (c.kind === 'number-map') {
    const v = next as Record<string, unknown>;
    for (const [k, n] of Object.entries(v)) {
      const err = numberIn(n, c.min, c.max, c.unit, false, k);
      if (err) return err;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The editor dialog: current value in full, the control, then diff + confirm.
// ---------------------------------------------------------------------------

function Editor({
  row,
  spec,
  onClose,
  onSave,
  saving,
}: {
  row: ConfigRow;
  spec: KeySpec;
  onClose: () => void;
  onSave: (value: unknown) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<unknown>(() => JSON.parse(JSON.stringify(row.value)));
  const [typed, setTyped] = useState('');
  const c = spec.control;
  const error = validate(row.key, spec, draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(row.value);
  const destructive = spec.danger === 'destructive';
  // A destructive flip is confirmed by typing the phrase, not by clicking OK
  // in a dialog that looks like every other dialog.
  const phrase = destructive ? 'DELETE FOR REAL' : '';
  const phraseOk = !destructive || draft === row.value || typed.trim() === phrase;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog" style={{ maxWidth: 720 }}>
        <div className="dialog-title">{spec.title}</div>
        <div className="dialog-label num" style={{ opacity: 0.7 }}>{row.key}</div>
        {row.description && <p className="dialog-lead">{row.description}</p>}

        {spec.warning && (
          <div className={destructive ? 'dialog-warn' : 'dialog-note'} style={{ marginBottom: 12 }}>
            {spec.warning}
          </div>
        )}
        {spec.coupledWith && <div className="dialog-note" style={{ marginBottom: 12 }}>{spec.coupledWith}</div>}

        {/* Current value, in full. Never truncated — this is the thing the
            admin is deciding against. */}
        <div className="dialog-label">Current value</div>
        <pre
          className="num"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 16px', fontSize: 13 }}
        >
          {displayValue(spec, row.value)}
        </pre>

        <div className="dialog-label">New value</div>
        <div style={{ margin: '8px 0 4px' }}>
          {c.kind === 'number' && (
            <NumberInput
              value={typeof draft === 'number' ? draft : ''}
              unit={c.unit}
              min={c.min}
              max={c.max}
              integer={c.integer}
              step={c.step}
              onChange={setDraft}
            />
          )}
          {c.kind === 'percent' && (
            <NumberInput
              value={typeof draft === 'number' ? toPercent(draft) : ''}
              unit="%"
              min={c.min}
              max={c.max}
              step={c.step}
              onChange={(v) => setDraft(v === '' ? '' : fromPercent(v))}
            />
          )}
          {c.kind === 'boolean' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className={`btn${draft === true ? '' : ' ghost'}`}
                onClick={() => setDraft(true)}
              >
                {c.onLabel ?? 'On'}
              </button>
              <button
                className={`btn${draft === false ? ' danger' : ' ghost'}`}
                onClick={() => setDraft(false)}
              >
                {c.offLabel ?? 'Off'}
              </button>
            </div>
          )}
          {c.kind === 'string-list' && (
            <StringListEditor spec={c} value={(draft as string[]) ?? []} onChange={setDraft} />
          )}
          {c.kind === 'fields' && (
            <div style={{ display: 'grid', gap: 10 }}>
              {c.fields.map((f) => {
                const v = (draft as Record<string, unknown>)?.[f.name];
                const shown = f.percent && typeof v === 'number' ? toPercent(v) : (v as number);
                return (
                  <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                    <span>{f.label}</span>
                    <NumberInput
                      value={typeof shown === 'number' && !Number.isNaN(shown) ? shown : ''}
                      unit={f.unit}
                      min={f.min}
                      max={f.max}
                      integer={f.integer}
                      onChange={(nv) =>
                        setDraft({
                          ...(draft as Record<string, unknown>),
                          [f.name]: nv === '' ? NaN : f.percent ? fromPercent(nv) : nv,
                        })
                      }
                    />
                  </label>
                );
              })}
            </div>
          )}
          {c.kind === 'matrix' && (
            <MatrixEditor spec={c} value={draft as Record<string, Record<string, number>>} onChange={setDraft} />
          )}
          {c.kind === 'records' && (
            <RecordsEditor spec={c} value={draft as Record<string, unknown>[]} onChange={setDraft} />
          )}
          {c.kind === 'number-map' && (
            <div style={{ display: 'grid', gap: 8 }}>
              {Object.entries((draft as Record<string, number>) ?? {}).map(([k, v]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                  <span>{k}</span>
                  <NumberInput
                    value={typeof v === 'number' && !Number.isNaN(v) ? v : ''}
                    unit={c.unit}
                    min={c.min}
                    max={c.max}
                    onChange={(nv) => setDraft({ ...(draft as Record<string, number>), [k]: nv === '' ? NaN : nv })}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {/* What changed, stated back before anything is written. */}
        {changed && !error && (
          <div className="dialog-facts" style={{ marginTop: 14 }}>
            <div className="dialog-label">This change</div>
            <div className="num" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {displayValue(spec, row.value)}
              {'\n  ↓\n'}
              {displayValue(spec, draft)}
            </div>
          </div>
        )}

        {error && (
          <div className="dialog-warn" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {destructive && changed && (
          <div style={{ marginTop: 14 }}>
            <div className="dialog-label">
              Type <span className="num">{phrase}</span> to confirm
            </div>
            <input
              className="input num"
              style={{ marginTop: 6 }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={phrase}
              autoComplete="off"
            />
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className={`btn${destructive ? ' danger' : ''}`}
            disabled={!changed || !!error || !phraseOk || saving}
            onClick={() => onSave(draft)}
          >
            {saving ? 'Saving…' : changed ? 'Save change' : 'No change'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Config() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<ConfigRow | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ config: ConfigRow[] }>('/v1/admin/config'),
  });

  const update = useMutation({
    mutationFn: (vars: { key: string; value?: unknown; confirmed?: boolean }) =>
      api<{ updated: boolean; created?: boolean }>(`/v1/admin/config/${encodeURIComponent(vars.key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: vars.value, confirmed: vars.confirmed }),
      }),
    onSuccess: (res, vars) => {
      setActionError(null);
      setSaved(`${vars.key} saved${res?.created ? ' (key created)' : ''}.`);
      setEditing(null);
    },
    // The endpoint now fails loudly when a write does not stick, so an error
    // here is a real one and is shown rather than swallowed.
    onError: (e) => {
      setActionError((e as Error).message);
      setSaved(null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const rows = data?.config ?? [];
  const unconfirmed = rows.filter((r) => !r.confirmed).length;
  const matches = (r: ConfigRow) => {
    if (!term) return true;
    const t = term.toLowerCase();
    return (
      r.key.toLowerCase().includes(t) ||
      r.description.toLowerCase().includes(t) ||
      (CONFIG_SCHEMA[r.key]?.title ?? '').toLowerCase().includes(t)
    );
  };

  const byGroup = useMemo(() => {
    const m = new Map<GroupId | 'other', ConfigRow[]>();
    for (const r of rows.filter(matches)) {
      const g = CONFIG_SCHEMA[r.key]?.group ?? 'other';
      m.set(g, [...(m.get(g) ?? []), r]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, term]);

  const editingSpec = editing ? CONFIG_SCHEMA[editing.key] : undefined;

  return (
    <>
      <h1 className="page-title">Config</h1>
      <p className="page-sub">
        Every business number the server reads. Unconfirmed means “working default, do not rely on
        it until confirmed”{unconfirmed ? ` (${unconfirmed} to review)` : ''}.
      </p>

      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}
      {saved && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--ok)', marginBottom: 12 }}>
          {saved}
        </div>
      )}

      <div className="toolbar">
        <input
          className="input"
          placeholder="Filter settings…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Filter config keys"
        />
      </div>

      {isLoading ? (
        <SectionSkeleton rows={8} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : rows.filter(matches).length === 0 ? (
        <EmptyState glyph="—">No settings match.</EmptyState>
      ) : (
        [...GROUPS.map((g) => g.id), 'other' as const].map((gid) => {
          const groupRows = byGroup.get(gid) ?? [];
          if (groupRows.length === 0) return null;
          const meta = GROUPS.find((g) => g.id === gid);
          return (
            <div className="section" key={gid}>
              <h2>{meta?.title ?? 'Not yet described'}</h2>
              <p className="page-sub" style={{ marginTop: -4 }}>
                {meta?.blurb ?? 'These keys have no control defined yet, so they stay read-only rather than being hidden.'}
              </p>
              <div className="card row-list">
                {groupRows.map((r) => {
                  const spec = CONFIG_SCHEMA[r.key];
                  const c = spec?.control;
                  const destructive = spec?.danger === 'destructive';
                  const high = spec?.danger === 'high';
                  return (
                    <div
                      key={r.key}
                      className="row"
                      style={
                        destructive
                          ? { borderLeft: '4px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 6%, transparent)' }
                          : high
                            ? { borderLeft: '4px solid var(--warn)' }
                            : undefined
                      }
                    >
                      <div className="who grow">
                        <div className="name">
                          {spec?.title ?? r.key}
                          {destructive && (
                            <span className="pill" style={{ marginLeft: 8, background: 'var(--danger)', color: '#fff' }}>
                              destructive
                            </span>
                          )}
                        </div>
                        <div className="sub num" style={{ opacity: 0.65 }}>{r.key}</div>
                        <div className="sub">
                          {r.description || 'No description'} · updated {formatWhen(r.updated_at)}
                        </div>
                        {/* Full value, wrapped rather than truncated. */}
                        <div
                          className="num"
                          style={{ marginTop: 6, fontWeight: 700, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                        >
                          {displayValue(spec, r.value)}
                        </div>
                      </div>

                      {r.confirmed ? (
                        <Pill tone="ok">confirmed</Pill>
                      ) : (
                        <button
                          className="btn ghost"
                          disabled={update.isPending}
                          onClick={() => {
                            if (window.confirm(`Confirm ${r.key} as the real business value?`))
                              update.mutate({ key: r.key, confirmed: true });
                          }}
                        >
                          Confirm
                        </button>
                      )}

                      {c?.kind === 'elsewhere' ? (
                        <Link className="btn ghost" to={c.where}>Edit on Payouts</Link>
                      ) : c?.kind === 'read-only' || !spec ? (
                        <span className="sub" style={{ maxWidth: 260, textAlign: 'right' }}>
                          {c?.kind === 'read-only' ? c.why : 'No control defined — read-only.'}
                        </span>
                      ) : (
                        <button className="btn ghost" disabled={update.isPending} onClick={() => { setSaved(null); setEditing(r); }}>
                          Edit
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {editing && editingSpec && (
        <Editor
          row={editing}
          spec={editingSpec}
          saving={update.isPending}
          onClose={() => setEditing(null)}
          onSave={(value) => update.mutate({ key: editing.key, value })}
        />
      )}
    </>
  );
}
