import { EmptyState } from '../components/ui';

// Sections migrate from the old portal one at a time so a break is
// attributable. Until a section moves, it points at the legacy page.
export function Placeholder({ title, legacy = true }: { title: string; legacy?: boolean }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">This section hasn’t been migrated to the new portal yet.</p>
      <div className="section">
        <EmptyState glyph="🚧">
          {legacy ? (
            <>
              Coming in a later increment — for now this still works in the{' '}
              <a href="/admin/legacy">legacy portal</a>.
            </>
          ) : (
            <>Coming in a later increment.</>
          )}
        </EmptyState>
      </div>
    </>
  );
}
