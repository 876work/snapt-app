import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Icon } from './icons';
import { Pill } from './ui';

interface SearchUser {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  suspended_at: string | null;
  creator: { vetting_status: string; verified: boolean } | null;
}

interface SearchBooking {
  id: string;
  status: string;
  occasion: string | null;
  type: string;
  area: string | null;
  scheduled_at: string | null;
  client_name: string | null;
  creator_name: string | null;
}

interface SearchResults {
  users: SearchUser[];
  bookings: SearchBooking[];
}

// One box, always in the header: names, emails, phones, booking references.
export function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<SearchResults>(`/v1/admin/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const go = (path: string) => {
    setOpen(false);
    setTerm('');
    navigate(path);
  };

  const showResults = open && debounced.length >= 2;
  const empty = data && data.users.length === 0 && data.bookings.length === 0;

  return (
    <div className="search" ref={boxRef}>
      <span className="icon">
        <Icon name="search" size={16} />
      </span>
      <input
        placeholder="Search bookings, users, creators…"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Global search"
      />
      {showResults && (
        <div className="results">
          {data?.users.length ? (
            <>
              <div className="group">People</div>
              {data.users.map((u) => (
                <button key={u.id} className="hit" onClick={() => go(`/users/${u.id}`)}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{u.full_name || '(no name)'}</div>
                    <div className="sub">{u.email ?? u.phone ?? u.id.slice(0, 8)}</div>
                  </div>
                  {u.creator && <Pill status={u.creator.vetting_status} />}
                  {u.suspended_at && <Pill status="suspended" />}
                </button>
              ))}
            </>
          ) : null}
          {data?.bookings.length ? (
            <>
              <div className="group">Bookings</div>
              {data.bookings.map((b) => (
                <button key={b.id} className="hit" onClick={() => go(`/bookings/${b.id}`)}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>
                      {b.occasion ?? b.type} · {b.client_name ?? 'client'}
                      {b.creator_name ? ` → ${b.creator_name}` : ''}
                    </div>
                    <div className="sub">
                      {b.id.slice(0, 8)} · {b.area ?? 'remote'}
                      {b.scheduled_at ? ` · ${new Date(b.scheduled_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                  <Pill status={b.status} />
                </button>
              ))}
            </>
          ) : null}
          {empty && !isFetching && <div className="none">No matches for “{debounced}”.</div>}
          {isFetching && !data && <div className="none">Searching…</div>}
        </div>
      )}
    </div>
  );
}
