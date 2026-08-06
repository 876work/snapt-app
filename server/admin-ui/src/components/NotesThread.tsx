import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { EmptyState, SectionSkeleton, formatWhen } from './ui';

interface Note {
  id: string;
  body: string;
  created_at: string;
  admin_name: string;
}

/** Internal notes on a record — attributed, timestamped, never user-visible. */
export function NotesThread({ subjectType, subjectId }: { subjectType: 'user' | 'booking' | 'creator'; subjectId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const key = ['notes', subjectType, subjectId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<{ notes: Note[] }>(`/v1/admin/notes?subject_type=${subjectType}&subject_id=${subjectId}`),
  });

  const add = useMutation({
    mutationFn: () =>
      api('/v1/admin/notes', {
        method: 'POST',
        body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId, body: draft }),
      }),
    onSuccess: () => setDraft(''),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="section">
      <h2>
        Internal notes <span className="count num">{data?.notes.length || ''}</span>
      </h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Add a note — team-only, never visible to the user…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() && !add.isPending) add.mutate();
          }}
        />
        <button className="btn" disabled={!draft.trim() || add.isPending} onClick={() => add.mutate()}>
          Add
        </button>
      </div>
      {isLoading ? (
        <SectionSkeleton rows={2} />
      ) : (data?.notes ?? []).length === 0 ? (
        <EmptyState glyph="✎">No notes yet. Anything worth remembering about this record goes here.</EmptyState>
      ) : (
        <div className="card row-list">
          {data!.notes.map((n) => (
            <div key={n.id} className="row">
              <div className="who grow">
                <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                <div className="sub" style={{ marginTop: 4 }}>
                  {n.admin_name} · {formatWhen(n.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
