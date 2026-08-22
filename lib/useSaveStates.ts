import React from 'react';
import { offerSettings, type SaveResult } from './saveToPhotos';
import { captureHandledError } from './sentry';

/**
 * SAVING A FILE, WITH THE THREE STATES A PERSON NEEDS TO SEE.
 *
 * Downloading a delivered file is not instant — these are full-resolution
 * photos and videos over a Caribbean uplink — and a control that shows
 * nothing while it runs leaves only two readings available: "the button is
 * broken" or "it finished instantly". Both invite a second tap, which starts
 * the whole transfer again.
 *
 * This is the creator source-list behaviour from 55408b3 lifted out so the
 * client's delivery screen uses the SAME implementation rather than a second
 * copy of it. That duplication is what left downloads broken in two places
 * for weeks (see shareFile's header) and it is not being re-created here.
 *
 *   idle    — nothing has happened to this file
 *   saving  — in flight; a second tap is REFUSED, not queued
 *   saved   — in the library
 *   failed  — with the reason, which is never the shape of either other state
 *
 * Keys are the caller's: a media id where there is one, a filename where
 * there is not. They only have to be stable and unique within one screen.
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export interface SaveTask {
  key: string;
  /** Runs the actual save. Returning a SaveResult, never throwing, is ideal —
   *  but a throw is caught and recorded rather than escaping. */
  run: () => Promise<SaveResult>;
}

export function useSaveStates(context: string) {
  const [saving, setSaving] = React.useState<Set<string>>(new Set());
  const [saved, setSaved] = React.useState<Set<string>>(new Set());
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /** Progress of a run-them-all, so the button is never a dead control. */
  const [batch, setBatch] = React.useState<{ done: number; total: number } | null>(null);
  // The in-flight guard reads a ref, not state: `run` is called from handlers
  // created a render ago, and a stale `saving` set would let the same file
  // start twice.
  const inFlight = React.useRef<Set<string>>(new Set());

  const stateOf = React.useCallback(
    (key: string): SaveState =>
      saving.has(key) ? 'saving' : errors[key] ? 'failed' : saved.has(key) ? 'saved' : 'idle',
    [saving, errors, saved],
  );

  /**
   * One file. Returns the result so a caller can decide what to do next;
   * never throws, and always leaves this key out of the in-flight set.
   */
  const runOne = React.useCallback(
    async (task: SaveTask): Promise<SaveResult> => {
      if (inFlight.current.has(task.key)) {
        return { ok: false, kind: 'save', message: 'Already saving this file.' };
      }
      inFlight.current.add(task.key);
      setSaving((prev) => new Set(prev).add(task.key));
      setErrors((prev) => {
        if (!prev[task.key]) return prev;
        const next = { ...prev };
        delete next[task.key];
        return next;
      });

      let result: SaveResult;
      try {
        result = await task.run();
      } catch (err) {
        // saveToPhotos is written to RETURN its failures, so reaching here is
        // something genuinely unexpected — reported, and still shown.
        captureHandledError(err, `useSaveStates:${context}`);
        result = {
          ok: false,
          kind: 'save',
          message: 'Something went wrong saving this file. Tap to try again.',
        };
      } finally {
        // Cleared before any branch below, so no exit can strand a spinner.
        inFlight.current.delete(task.key);
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(task.key);
          return next;
        });
      }

      if (result.ok) {
        setSaved((prev) => new Set(prev).add(task.key));
      } else {
        setErrors((prev) => ({ ...prev, [task.key]: result.ok ? '' : result.message }));
      }
      return result;
    },
    [context],
  );

  /** One file, plus the Settings prompt when the OS will no longer ask. */
  const save = React.useCallback(
    async (task: SaveTask): Promise<boolean> => {
      const result = await runOne(task);
      offerSettings(result);
      return result.ok;
    },
    [runOne],
  );

  /**
   * Every file, in order, each with its own outcome on its own row.
   *
   * One file's failure does not stop the rest — a delivery where file three
   * fails must still land files four and five. The Settings prompt is offered
   * ONCE at the end rather than per file, because a blocked permission blocks
   * all of them and N identical alerts is not N pieces of information.
   */
  const saveAll = React.useCallback(
    async (tasks: SaveTask[]): Promise<{ ok: number; failed: number }> => {
      if (tasks.length === 0) return { ok: 0, failed: 0 };
      setBatch({ done: 0, total: tasks.length });
      let ok = 0;
      let failed = 0;
      let blocked: SaveResult | null = null;
      try {
        for (const task of tasks) {
          const result = await runOne(task);
          if (result.ok) ok += 1;
          else {
            failed += 1;
            if (!blocked && result.kind === 'permission_blocked') blocked = result;
          }
          setBatch((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        }
      } finally {
        // Whatever happened, the button stops claiming to be busy.
        setBatch(null);
      }
      if (blocked) offerSettings(blocked);
      return { ok, failed };
    },
    [runOne],
  );

  return { stateOf, errors, save, saveAll, batch, saving, saved };
}
