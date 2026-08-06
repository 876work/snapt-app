import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Pill, SectionSkeleton, formatWhen } from '../components/ui';

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

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['team'],
    queryFn: () => api<{ members: Member[] }>('/v1/admin/team'),
  });

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

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Team</h1>
        <button className="btn" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Close' : 'Add member'}
        </button>
      </div>
      <p className="page-sub">
        Portal accounts and their roles. New members set their own password from an emailed link
        that expires — passwords are never set here. Deactivation cuts access on their very next
        request.
      </p>
      {actionError && (
        <div className="card" style={{ padding: 12, borderLeft: '4px solid var(--danger)', marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      {creating && (
        <div className="card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12, maxWidth: 460 }}>
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

      {isLoading ? (
        <SectionSkeleton rows={4} />
      ) : isError ? (
        <EmptyState glyph="⚠">{(error as Error).message}</EmptyState>
      ) : (
        <div className="card row-list">
          {data!.members.map((m) => (
            <div key={m.user_id} className="row" style={{ opacity: m.active ? 1 : 0.55 }}>
              <div className="who grow">
                <div className="name">
                  {m.name || '(no name)'}
                  {isSelf(m) ? ' · you' : ''}
                </div>
                <div className="sub">
                  {m.email ?? '—'} · added {formatWhen(m.created_at)} ·{' '}
                  {m.last_sign_in_at ? `last sign-in ${formatWhen(m.last_sign_in_at)}` : 'never signed in'}
                </div>
              </div>
              {!m.active && <Pill tone="neutral">deactivated</Pill>}
              {isSelf(m) ? (
                <Pill status={m.role} />
              ) : (
                <>
                  <select
                    className="input"
                    style={{ minWidth: 120, padding: '6px 10px' }}
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
                    <button className="btn ghost" disabled={reactivate.isPending} onClick={() => reactivate.mutate(m.user_id)}>
                      Reactivate
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
