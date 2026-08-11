import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { SavedViews } from '../components/SavedViews';
import { Freshness, ListState, Pill, fetchState, formatWhen } from '../components/ui';
import { AccountSwitch } from '../components/AccountSwitch';

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mode: string;
  created_at: string;
  suspended_at: string | null;
  status?: 'active' | 'disabled';
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

  const q = useQuery({
    queryKey: ['users', debounced],
    queryFn: () => api<{ users: UserRow[] }>(`/v1/admin/users?q=${encodeURIComponent(debounced)}&limit=50`),
    placeholderData: keepPreviousData,
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  const { state, stale } = fetchState(q);

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
      <div className="page-head">
        <h1 className="page-title">Users</h1>
        {identity?.role === 'admin' && (
          <button className="btn" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Close' : 'New user'}
          </button>
        )}
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
      <p className="page-sub">
        Every account — clients and creators. Search covers name, email, and phone.
      </p>

      {creating && (
        <div className="t-card" style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 460 }}>
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

      <div className="list-toolbar">
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

      <ListState
        status={state}
        isEmpty={rows.length === 0}
        error={(error as Error | null)?.message}
        onRetry={() => refetch()}
        rows={6}
        empty={
          debounced
            ? `No users match “${debounced}”.`
            : filter === 'suspended'
              ? 'Nobody is suspended — every account is in good standing.'
              : filter === 'creators'
                ? 'No creator accounts yet.'
                : 'No users yet.'
        }
      >
        <div className="t-table-card">
          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Joined</th>
                  <th className="right">Status</th>
                  <th className="right">Access</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="clickable" onClick={() => navigate(`/users/${u.id}`)}>
                    <td>
                      <div className="cell-title">{u.full_name || '(no name)'}</div>
                    </td>
                    <td>
                      <div>{u.email ?? '—'}</div>
                      <div className="cell-sub num">{u.phone ?? 'no phone'}</div>
                    </td>
                    <td className="nowrap num">{formatWhen(u.created_at)}</td>
                    <td className="right">
                      <div className="cell-pills">
                        {u.false_report_count > 0 && (
                          <Pill tone="warn">
                            {u.false_report_count} false report{u.false_report_count === 1 ? '' : 's'}
                          </Pill>
                        )}
                        {u.creator && <Pill status={u.creator.vetting_status} />}
                        {u.status === 'disabled' && <Pill tone="warn">Disabled</Pill>}
                        {u.suspended_at ? <Pill status="suspended" /> : <Pill tone="neutral">{u.mode}</Pill>}
                      </div>
                    </td>
                    <td className="right">
                      <div className="cell-actions">
                        <AccountSwitch userId={u.id} status={u.status ?? 'active'} compact />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ListState>
    </>
  );
}
