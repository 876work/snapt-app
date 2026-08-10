import React from 'react';
import { View } from 'react-native';
import { create } from 'zustand';

/**
 * FIRST-RUN TOUR — state, persistence, and the target registry.
 *
 * Three things live here so no screen has to know about the others:
 *
 *   1. ONE AsyncStorage key holding { seen, attempts }. Two keys — "done"
 *      and "started" — would drift apart on exactly one phone and nobody
 *      would reproduce it. One object cannot disagree with itself.
 *
 *   2. A ref REGISTRY, because two of the four targets live in the floating
 *      nav pill and two live inside Home's scroll view — different component
 *      trees. Measuring real rendered positions is the point: hardcoded tab
 *      geometry breaks silently the next time the pill changes, and a halo
 *      floating over nothing is worse than no tour at all.
 *
 *   3. The step machine, so the overlay is a pure renderer.
 */

const KEY = 'snapt.tour.v1';

export interface TourRecord {
  /** Finished, skipped, or aged out — never show again. */
  seen: boolean;
  /** How many times it has STARTED. A kill mid-tour leaves this at 1. */
  attempts: number;
}

async function readRecord(): Promise<TourRecord> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { seen: false, attempts: 0 };
    const parsed = JSON.parse(raw) as Partial<TourRecord>;
    return { seen: parsed.seen === true, attempts: Number(parsed.attempts) || 0 };
  } catch {
    // A storage failure must not spawn a tour on every launch. Treat an
    // unreadable record as seen: silence is the safer wrong answer.
    return { seen: true, attempts: 0 };
  }
}

async function writeRecord(record: TourRecord): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* best effort — a failed write costs at most one extra showing */
  }
}

/** Finished or skipped. Never shows again. */
export async function markTourSeen(): Promise<void> {
  const record = await readRecord();
  await writeRecord({ seen: true, attempts: record.attempts });
}

/**
 * Existing users with booking history are marked done without ever seeing
 * it — a tour explaining how to book is noise to someone who already has.
 */
export async function markTourSeenSilently(): Promise<void> {
  const record = await readRecord();
  if (!record.seen) await writeRecord({ seen: true, attempts: record.attempts });
}

/**
 * Should the tour run now, and record that it started.
 *
 * A kill mid-tour leaves attempts=1 with seen=false, so it gets ONE more
 * showing. That second showing is marked seen the moment it starts, so an
 * app that crashes on this screen can never loop the tour forever.
 */
export async function claimTourRun(): Promise<boolean> {
  const record = await readRecord();
  if (record.seen) return false;
  const attempts = record.attempts + 1;
  // Second attempt is the last one, whatever happens to it.
  await writeRecord({ seen: attempts >= 2, attempts });
  return true;
}

// ---- Target registry -------------------------------------------------------

export type TourTarget = 'quickstart' | 'footage' | 'messages' | 'profile';

const targets = new Map<TourTarget, View | null>();

/** Called by whichever component owns the element, from any tree. */
export function registerTourTarget(id: TourTarget, node: View | null): void {
  if (node) targets.set(id, node);
  else targets.delete(id);
}

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Measure where a target actually IS right now. Returns null when the
 * element is not mounted or measures to nothing — the overlay then skips
 * that step rather than drawing a halo over empty space.
 */
export function measureTarget(id: TourTarget): Promise<TargetRect | null> {
  const node = targets.get(id);
  if (!node) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 400);
    try {
      node.measureInWindow((x, y, width, height) => {
        clearTimeout(timeout);
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

// ---- Step machine ----------------------------------------------------------

export const TOUR_STEPS: { target: TourTarget; title: string; body: string }[] = [
  {
    target: 'quickstart',
    title: 'Start here',
    body: 'Tell us the occasion, when and where — we find you a creator who is free and nearby.',
  },
  {
    target: 'footage',
    title: 'Already shot it?',
    body: 'Send us footage you have taken yourself and one of our editors turns it around for you.',
  },
  {
    target: 'messages',
    title: 'Your creator, one tap away',
    body: 'Once you are booked, this is where the two of you sort out the details.',
  },
  {
    target: 'profile',
    title: 'Everything else lives here',
    body: 'Your currency, your bookings, help — and the way in if you ever want to shoot for Snapt.',
  },
];

type Phase = 'idle' | 'welcome' | 'tour';

interface TourState {
  phase: Phase;
  step: number;
  start: () => void;
  beginSteps: () => void;
  next: () => void;
  end: () => void;
}

export const useTour = create<TourState>((set, get) => ({
  phase: 'idle',
  step: 0,
  start: () => set({ phase: 'welcome', step: 0 }),
  beginSteps: () => set({ phase: 'tour', step: 0 }),
  next: () => {
    const next = get().step + 1;
    if (next >= TOUR_STEPS.length) {
      set({ phase: 'idle', step: 0 });
      void markTourSeen();
      return;
    }
    set({ step: next });
  },
  end: () => {
    set({ phase: 'idle', step: 0 });
    void markTourSeen();
  },
}));
