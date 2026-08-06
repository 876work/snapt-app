import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { navItemsFor } from './Layout';
import { useAuth } from '../auth';
import { Pill } from './ui';

interface SearchResults {
  users: { id: string; full_name: string; email: string | null; creator: { vetting_status: string } | null }[];
  bookings: { id: string; status: string; occasion: string | null; type: string; client_name: string | null }[];
}

/** ⌘K / Ctrl+K — jump to any section or search from anywhere. */
export function CommandPalette() {
  const { identity } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setTerm('');
        setSelected(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const { data } = useQuery({
    queryKey: ['palette-search', term],
    queryFn: () => api<SearchResults>(`/v1/admin/search?q=${encodeURIComponent(term.trim())}`),
    enabled: open && term.trim().length >= 2,
    staleTime: 30_000,
  });

  const sections = useMemo(() => {
    if (!identity) return [];
    const items = navItemsFor(identity.role).map((n) => ({ label: n.label, to: n.to }));
    if (identity.role === 'admin') items.push({ label: 'Team', to: '/team' });
    const t = term.trim().toLowerCase();
    return t ? items.filter((i) => i.label.toLowerCase().includes(t)) : items;
  }, [identity, term]);

  const entries = useMemo(() => {
    const rows: { key: string; label: string; sub?: string; pill?: string; to: string }[] = sections.map((s) => ({
      key: `nav:${s.to}`,
      label: s.label,
      sub: 'Go to section',
      to: s.to,
    }));
    for (const u of data?.users ?? []) {
      rows.push({
        key: `u:${u.id}`,
        label: u.full_name || '(no name)',
        sub: u.email ?? undefined,
        pill: u.creator ? u.creator.vetting_status : undefined,
        to: `/users/${u.id}`,
      });
    }
    for (const b of data?.bookings ?? []) {
      rows.push({
        key: `b:${b.id}`,
        label: `${b.occasion ?? b.type} · ${b.client_name ?? 'client'}`,
        sub: b.id.slice(0, 8),
        pill: b.status,
        to: `/bookings/${b.id}`,
      });
    }
    return rows;
  }, [sections, data]);

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  if (!open) return null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="palette-scrim" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a section, or search users and bookings…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, entries.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            }
            if (e.key === 'Enter' && entries[selected]) go(entries[selected].to);
          }}
        />
        <div className="palette-list">
          {entries.length === 0 && <div className="palette-empty">Nothing matches.</div>}
          {entries.map((r, i) => (
            <button
              key={r.key}
              className={`palette-row${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => go(r.to)}
            >
              <span className="grow" style={{ textAlign: 'left' }}>
                <span style={{ fontWeight: 600 }}>{r.label}</span>
                {r.sub && <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>{r.sub}</span>}
              </span>
              {r.pill && <Pill status={r.pill} />}
            </button>
          ))}
        </div>
        <div className="palette-hint">↑↓ navigate · Enter open · Esc close</div>
      </div>
    </div>
  );
}
