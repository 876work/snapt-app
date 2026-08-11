import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { Freshness, ListState, Pill, fetchState, formatWhen } from '../components/ui';

interface Member {
  user_id: string;
  role: 'admin' | 'support' | 'moderator';
  active: boolean;
  created_at: string;
  name: string;
  email: string | null;
  last_sign_in_at: string | null;
}

export function Team() {
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'support' });

  const q = useQuery({
    queryKey: ['team'],
    queryFn: () => api<{ members: Member[] }>('/v1/admin/team'),
  });
  const { data, error, refetch, dataUpdatedAt } = q;
  const { state, stale } = fetchState(q);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team'] });
  const onErr = (e: unknown) => setActionError((e as Error).message);
  const create = useMutation({
    mutationFn: () => api('/v1/admin/team', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      setActionError(null);
      setCreating(false);
      setForm({ name: '', email: '', role: 'support' });
    },
    onError: onErr,
    onSettled: refresh,
  });
  const changeRole = useMutation({
    mutationFn: (vars: { userId: string; role: string }) =>
      api(`/v1/admin/team/${vars.userId}`, { method: 'PUT', body: JSON.stringify({ role: vars.role }) }),
    onSuccess: () => setActionError(null),
    onError: onErr,
    onSettled: refresh,
  });
  const deactivate = useMutation({
    mutationFn: (userId: string) => api(`/v1/admin/team/${userId}/deactivate`, { method: 'POST' }),
    onSuccess: () => setActionError(null),
    onError: onErr,
    onSettled: refresh,
  });
  const reactivate = useMutation({
    mutationFn: (userId: string) => api(`/v1/admin/team/${userId}/reactivate`, { method: 'POST' }),
    onSuccess: () => setActionError(null),
    onError: onErr,
    onSettled: refresh,
  });

  const isSelf = (m: Member) => identity?.admin_id === m.user_id;
  // Was `data!.members` — which throws outright in the window where the query
  // is neither loading nor errored but has no data yet.
  const members = data?.members ?? [];

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Team</h1>
        <button className="btn" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Close' : 'Add member'}
        </button>
        <Freshness status={state} isStale={stale} updatedAt={dataUpdatedAt} />
      </div>
      <p className="page-sub">
        Portal accounts and their roles. New members set their own password from an emailed link
        that expires — passwords are never set here. Deactivation cuts access on their very next
        request.
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', margin: '14px 0' }}>
          {actionError}
        </div>
      )}

      {creating && (
        <div className="t-card" style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 460 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>
            Name
            <input
              className="input"
              style={{ display: 'block', width: '100%', marginTop: 5 }}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full name"
            />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>
            Email
            <input
              className="input"
              type="email"
              style={{ display: 'block', width: '100%', marginTop: 5 }}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="them@snaptcarib.app"
            />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>
            Role
            <select
              className="input"
              style={{ display: 'block', width: '100%', marginTop: 5 }}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="admin">Admin — everything, incl. money release and this screen</option>
              <option value="support">Support — day-to-day ops, no money release or config</option>
              <option value="moderator">Moderator — moderation queue only</option>
            </select>
          </label>
          <div>
            <button className="btn" disabled={create.isPending || !form.email} onClick={() => create.mutate()}>
              {create.isPending ? 'Sending invite…' : 'Create & send invite'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <ListState
          status={state}
          isEmpty={members.length === 0}
          error={(error as Error | null)?.message}
          onRetry={() => refetch()}
          rows={3}
          empty="No portal accounts on record. Add the first one with “Add member” above."
        >
          <div className="t-table-card">
            <div className="t-table-scroll">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Email</th>
                    <th>Added</th>
                    <th>Last sign-in</th>
                    <th>Role</th>
                    <th className="right">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} className={m.active ? '' : 'dimmed'}>
                      <td>
                        <div className="cell-title">
                          {m.name || '(no name)'}
                          {isSelf(m) ? ' · you' : ''}
                        </div>
                        {!m.active && (
                          <div style={{ marginTop: 4 }}>
                            <Pill tone="neutral">deactivated</Pill>
                          </div>
                        )}
                      </td>
                      <td>{m.email ?? '—'}</td>
                      <td className="nowrap num">{formatWhen(m.created_at)}</td>
                      <td className="nowrap num">
                        {m.last_sign_in_at ? (
                          formatWhen(m.last_sign_in_at)
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>never</span>
                        )}
                      </td>
                      <td>
                        {isSelf(m) ? (
                          <Pill status={m.role} />
                        ) : (
                          <select
                            className="input"
                            style={{ minWidth: 118, padding: '6px 10px' }}
                            value={m.role}
                            disabled={changeRole.isPending || !m.active}
                            onChange={(e) => {
                              const role = e.target.value;
                              if (window.confirm(`Change ${m.name || m.email} to ${role}?`))
                                changeRole.mutate({ userId: m.user_id, role });
                              else refresh();
                            }}
                          >
                            <option value="admin">admin</option>
                            <option value="support">support</option>
                            <option value="moderator">moderator</option>
                          </select>
                        )}
                      </td>
                      <td className="right">
                        {!isSelf(m) && (
                          <div className="cell-actions">
                            {m.active ? (
                              <button
                                className="btn ghost"
                                disabled={deactivate.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Deactivate ${m.name || m.email}? Their session ends on their next request. This is reversible.`,
                                    )
                                  )
                                    deactivate.mutate(m.user_id);
                                }}
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                className="btn ghost"
                                disabled={reactivate.isPending}
                                onClick={() => reactivate.mutate(m.user_id)}
                              >
                                Reactivate
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </ListState>
      </div>
    </>
  );
}
