import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ListState, fetchState, formatWhen } from './ui';

interface Note {
  id: string;
  body: string;
  created_at: string;
  admin_name: string;
}

/**
 * Internal notes on a record — attributed, timestamped, never user-visible.
 *
 * This had the green-tick bug, on all three detail screens at once: the read
 * went `isLoading ? skeleton : notes.length === 0 ? "No notes yet"` with no
 * failure branch at all, so a failed fetch told you this record had nothing
 * worth remembering. On the creator screen that is the sentence you read
 * immediately before approving somebody.
 *
 * The write had the mirror of it: a failed POST cleared nothing and said
 * nothing, so a note that never saved looked like a note you forgot to type.
 */
export function NotesThread({ subjectType, subjectId }: { subjectType: 'user' | 'booking' | 'creator'; subjectId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const key = ['notes', subjectType, subjectId];

  const q = useQuery({
    queryKey: key,
    queryFn: () => api<{ notes: Note[] }>(`/v1/admin/notes?subject_type=${subjectType}&subject_id=${subjectId}`),
  });
  const { data, error, refetch } = q;
  const { state } = fetchState(q);

  const add = useMutation({
    mutationFn: () =>
      api('/v1/admin/notes', {
        method: 'POST',
        body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId, body: draft }),
      }),
    onSuccess: () => setDraft(''),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const notes = data?.notes ?? [];
  const subject = subjectType === 'booking' ? 'booking' : subjectType === 'creator' ? 'creator' : 'account';

  return (
    <div className="t-card">
      <div className="t-card-head">
        <h2>Internal notes</h2>
        {/* Was `|| ''`, so a genuine zero rendered as a missing count. */}
        {state === 'success' && <span className="meta num">{notes.length}</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
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
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {/* A note that failed to save is an event, not silence. The draft is
          still in the box, so the retry is one click on Add. */}
      {add.isError && (
        <div className="lst-inline failed" role="alert" style={{ marginBottom: 14 }}>
          <span>⚠</span>
          <span>
            That note was not saved — {(add.error as Error).message}. Your text is still in the box.
          </span>
        </div>
      )}

      <ListState
        status={state}
        isEmpty={notes.length === 0}
        error={(error as Error | null)?.message}
        errorHint={`The notes on this ${subject} could not be read. This is not the same as there being none — do not treat this record as unannotated.`}
        onRetry={() => refetch()}
        rows={2}
        empty="No notes yet. Anything worth remembering about this record goes here."
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {notes.map((n) => (
            <div key={n.id} className="tl-card">
              <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div className="tl-when" style={{ marginTop: 5 }}>
                {n.admin_name} · {formatWhen(n.created_at)}
              </div>
            </div>
          ))}
        </div>
      </ListState>
    </div>
  );
}
