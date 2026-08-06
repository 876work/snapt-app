import { useState } from 'react';

interface SavedView {
  name: string;
  value: string;
}

const keyFor = (screen: string) => `snapt.admin.views.${screen}`;

function load(screen: string): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem(keyFor(screen)) ?? '[]') as SavedView[];
  } catch {
    return [];
  }
}

/**
 * Saved filters for a queue screen. `value` is whatever serialized state the
 * screen uses (filter key, search term…); stored per-browser.
 */
export function SavedViews({
  screen,
  current,
  onApply,
}: {
  screen: string;
  current: string;
  onApply: (value: string) => void;
}) {
  const [views, setViews] = useState<SavedView[]>(() => load(screen));

  const persist = (next: SavedView[]) => {
    setViews(next);
    localStorage.setItem(keyFor(screen), JSON.stringify(next));
  };

  const save = () => {
    const name = window.prompt('Name this view:');
    if (!name?.trim()) return;
    persist([...views.filter((v) => v.name !== name.trim()), { name: name.trim(), value: current }]);
  };

  return (
    <div className="chip-row" style={{ alignItems: 'center' }}>
      {views.map((v) => (
        <span key={v.name} className={`chip${v.value === current ? ' active' : ''}`} style={{ display: 'inline-flex', gap: 6 }}>
          <span onClick={() => onApply(v.value)} style={{ cursor: 'pointer' }}>
            {v.name}
          </span>
          <span
            aria-label={`Delete saved view ${v.name}`}
            style={{ cursor: 'pointer', opacity: 0.55 }}
            onClick={() => persist(views.filter((x) => x.name !== v.name))}
          >
            ×
          </span>
        </span>
      ))}
      <button className="chip" onClick={save} title="Save the current filter as a view">
        ☆ Save view
      </button>
    </div>
  );
}
