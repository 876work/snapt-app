import React from 'react';

/**
 * "THAT TIME WAS JUST TAKEN" → "CHANGE DATE OR DETAILS".
 *
 * Carries the one thing Date & Time cannot work out for itself: that this
 * visit is a recovery from a conflict, whose slot was lost, and for whom.
 *
 * A module singleton rather than a navigation param or a field on the booking
 * draft, for two reasons. Date & Time is already MOUNTED further down the
 * stack when this is set — dismissTo pops back to the live screen rather than
 * building a new one, so a param would not necessarily re-run anything, while
 * a subscription does. And the booking draft is the user's answers; this is
 * not one of their answers, it is a note about how they got here.
 *
 * Nothing here filters or decides. Date & Time applies it, and does so
 * defensively: the creator filter only holds while the draft still names that
 * creator, and the taken-slot marker only on the day it was taken. A stale
 * record therefore stops applying by itself rather than following someone
 * into their next booking.
 */
export interface SlotRecovery {
  /** null when the slot itself vanished rather than a specific creator's. */
  creatorId: string | null;
  /** First name, for a message that can say who. */
  creatorName: string | null;
  /** The slot that was lost — shown as unavailable rather than left absent. */
  takenTime: string;
  /** ISO day the slot was lost on. The marker is only true of this day. */
  date: string;
}

let pending: SlotRecovery | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function beginSlotRecovery(v: SlotRecovery): void {
  pending = v;
  emit();
}

export function endSlotRecovery(): void {
  if (!pending) return;
  pending = null;
  emit();
}

function getSnapshot(): SlotRecovery | null {
  return pending;
}

export function useSlotRecovery(): SlotRecovery | null {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot,
    getSnapshot,
  );
}

/* ------------------------------------------------------------------ *
 * The rules, kept out of the screen so they can be tested directly.
 * ------------------------------------------------------------------ */

export interface ResolvedRecovery {
  /** Set only while the draft still names the creator we came back for. */
  filterCreatorId: string | null;
  /** Set only on the day the slot was lost. */
  takenTime: string | null;
  inRecovery: boolean;
}

/**
 * Which half of a recovery still applies, given where the draft has got to.
 *
 * The two expire independently, and both have to: someone who picks another
 * day must keep the creator filter (that is what they came here for) but must
 * NOT keep seeing "18:00 taken" on a day where nothing was taken.
 */
export function resolveRecovery(
  recovery: SlotRecovery | null,
  draftCreatorId: string | null,
  draftDate: string | null,
): ResolvedRecovery {
  const filterCreatorId =
    recovery?.creatorId && recovery.creatorId === draftCreatorId ? recovery.creatorId : null;
  const takenTime = recovery && recovery.date === draftDate ? recovery.takenTime : null;
  return { filterCreatorId, takenTime, inRecovery: filterCreatorId != null || takenTime != null };
}

/** Slot times this creator is actually free for — or every bookable time. */
export function timesForCreator(
  slots: { time: string; creator_ids: string[] }[],
  creatorId: string | null,
): string[] {
  return slots
    .filter((s) => (creatorId ? s.creator_ids.includes(creatorId) : s.creator_ids.length > 0))
    .map((s) => s.time);
}

/** '9:00' sorts after '10:30' as a string. Compare the clock, not the text. */
function minutesOf(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

/**
 * The lost slot put back into the day, disabled, in its right place. Left out
 * — which is what the server does, because it is genuinely no longer
 * available — it just looks like the time moved on its own.
 */
export function mergeTakenSlot(
  times: string[],
  takenTime: string | null,
): { time: string; taken: boolean }[] {
  const live = times.map((time) => ({ time, taken: false }));
  if (!takenTime || live.some((c) => c.time === takenTime)) return live;
  return [...live, { time: takenTime, taken: true }].sort(
    (a, b) => minutesOf(a.time) - minutesOf(b.time),
  );
}
