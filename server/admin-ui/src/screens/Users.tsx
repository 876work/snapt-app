import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { SavedViews } from '../components/SavedViews';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mode: string;
  created_at: string;
  suspended_at: string | null;
  false_report_count: number;
  creator: { vetting_status: string; verified: boolean } | null;
}

type Filter = 'all' | 'suspended' | 'creators';

export function Users() {
  const navigate = useNavigate();
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['users', debounced],
    queryFn: () => api<{ users: UserRow[] }>(`/v1/admin/users?q=${encodeURIComponent(debounced)}&limit=50`),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: () => api<{ user_id: string }>('/v1/admin/users', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: (res) => {
      setCreating(false);
      setForm({ full_name: '', email: '', phone: '' });
      setCreateError(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      navigate(`/users/${res.user_id}`);
    },
    onError: (e) => setCreateError((e as Error).message),
  });

  const rows = (data?.users ?? []).filter((u) =>
    filter === 'suspended' ? u.suspended_at : filter === 'creators' ? u.creator : true,
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Users</h1>
        {identity?.role === 'admin' && (
          <button className="btn" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Close' : 'New user'}
          </button>
        )}
      </div>
      <p className="page-sub">
        Every account — clients and creators. Search covers name, email, and phone.
      </p>

      {creating && (
        <div className="card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12, maxWidth: 460 }}>
          <div style={{ fontWeight: 700 }}>Create an account for someone</div>
          <div className="sub" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
            For phone sign-ups. They get a set-password email — you never handle their password.
            Creators still apply in-app afterwards (use “Invite to apply” on their record).
          </div>
          <input
            className="input"
            placeholder="Full name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <input
            className="input"
            type="email"
            placeholder="Email (required)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            className="input"
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          {createError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{createError}</div>}
          <div>
            <button className="btn" disabled={create.isPending || !form.email} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create & send set-password email'}
            </button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          className="input"
          placeholder="Search name, email, phone…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search users"
        />
        <div className="chip-row">
          {(['all', 'suspended', 'creators'] as Filter[]).map((f) => (
            <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'suspended' ? 'Suspended' : 'Creators'}
            </button>
          ))}
        </div>
        <SavedViews
          screen="users"
          current={JSON.stringify({ term, filter })}
          onApply={(v) => {
            try {
              const s = JSON.parse(v) as { term: string; filter: Filter };
              setTerm(s.term);
              setFilter(s.filter);
            } catch {
              /* stale view */
            }
          }}
        />
      </div>

      {isLoading ? (
        <SectionSkeleton rows={6} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState glyph="—">
          {debounced ? `No users match “${debounced}”.` : 'No users yet.'}
        </EmptyState>
      ) : (
        <div className="card row-list">
          {rows.map((u) => (
            <div key={u.id} className="row row-link" onClick={() => navigate(`/users/${u.id}`)}>
              <div className="who grow">
                <div className="name">{u.full_name || '(no name)'}</div>
                <div className="sub">
                  {u.email ?? '—'} · {u.phone ?? 'no phone'} · joined {formatWhen(u.created_at)}
                </div>
              </div>
              {u.false_report_count > 0 && <Pill tone="warn">{u.false_report_count} false report{u.false_report_count === 1 ? '' : 's'}</Pill>}
              {u.creator && <Pill status={u.creator.vetting_status} />}
              {u.suspended_at ? <Pill status="suspended" /> : <Pill tone="neutral">{u.mode}</Pill>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
