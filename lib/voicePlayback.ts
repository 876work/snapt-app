import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureHandledError } from './sentry';

/**
 * Two small pieces of chat-audio state that outlive any one bubble:
 *
 * 1. THE ONE-PLAYER RULE. Only one voice note plays at a time — starting a
 *    second stops the first (spec'd; overlapping audio in one thread is
 *    chaos). Bubbles register a stop callback when they begin playing; a
 *    new claim invokes the previous one.
 *
 * 2. PLAYED STATE for the unplayed dot, persisted per device in
 *    AsyncStorage. Device-local by design: the dot is a reading aid like
 *    the unread badge, not synced state — and it must survive app restarts
 *    or every old note would look new again.
 */

interface VoicePlaybackState {
  playingId: string | null;
  /** Registers this note's stop callback, then stops every OTHER live note. */
  claim: (id: string, stop: () => void) => void;
  /** Unregisters `id`; clears the floor only if it still holds it. */
  release: (id: string) => void;
}

/**
 * EVERY note with a live player, keyed by message id — not one callback.
 *
 * This used to be a single module-level `currentStop`, and that is what let
 * two notes play at once. It held exactly ONE handle on "the note that is
 * sounding", so anything that nulled it disarmed the stop entirely and a
 * later claim had nothing to call:
 *
 *   - `release()` nulls it, and it is called from unmount, from the
 *     status-error path, from toggle and at end-of-playback;
 *   - and crucially, expo-audio's `remove()` does NOT stop playback on
 *     either platform — Android does `players.remove(player.id)`, iOS does
 *     `registry.remove(player)`. Both merely unregister.
 *
 * So the unmount and error paths — `remove()` immediately followed by
 * `release()` — could leave a note still audible while simultaneously
 * throwing away the only means of stopping it. After that, starting any
 * other note stopped nothing, on both platforms.
 *
 * A registry fixes the class, not just the instance: a claim stops every
 * other registered note rather than trusting one handle to have survived.
 * Stopping an already-stopped note is a harmless no-op, so over-stopping is
 * the safe direction.
 */
const stops = new Map<string, () => void>();

export const useVoicePlayback = create<VoicePlaybackState>((set) => ({
  playingId: null,
  claim: (id, stop) => {
    stops.set(id, stop);
    for (const [otherId, stopOther] of stops) {
      if (otherId === id) continue;
      try {
        stopOther();
      } catch (err) {
        // One dead player must not prevent the rest being stopped, but it is
        // never swallowed — a stop that cannot run is how this bug sounded.
        captureHandledError(err, 'voicePlayback:stop-other');
      }
    }
    set({ playingId: id });
  },
  release: (id) => {
    stops.delete(id);
    set((s) => (s.playingId === id ? { playingId: null } : s));
  },
}));

/**
 * 3. PENDING SENDS, module-level so they outlive the thread screen.
 *    A failed upload's "Not sent + Retry + Delete" bubble and an
 *    interrupted recording's send/discard decision must survive
 *    navigating away and back — component state silently discarded
 *    them, which is exactly the "never silently lose it" rule broken.
 *    (App-kill still loses in-flight state, same as a typed draft;
 *    the recording file itself sits in cache either way.)
 */
export interface PendingVoiceSend {
  tempId: string;
  uri: string;
  durationSec: number;
  status: 'uploading' | 'failed';
  error?: string;
}
export interface InterruptedRecording {
  uri: string;
  durationSec: number;
  interrupted?: boolean;
}

interface VoiceSendState {
  pendingByBooking: Record<string, PendingVoiceSend[]>;
  interruptedByBooking: Record<string, InterruptedRecording | null>;
  upsertPending: (bookingId: string, note: PendingVoiceSend) => void;
  removePending: (bookingId: string, tempId: string) => void;
  markFailed: (bookingId: string, tempId: string, error: string) => void;
  setInterrupted: (bookingId: string, rec: InterruptedRecording | null) => void;
}

export const useVoiceSends = create<VoiceSendState>((set) => ({
  pendingByBooking: {},
  interruptedByBooking: {},
  upsertPending: (bookingId, note) =>
    set((s) => ({
      pendingByBooking: {
        ...s.pendingByBooking,
        [bookingId]: [...(s.pendingByBooking[bookingId] ?? []).filter((p) => p.tempId !== note.tempId), note],
      },
    })),
  removePending: (bookingId, tempId) =>
    set((s) => ({
      pendingByBooking: {
        ...s.pendingByBooking,
        [bookingId]: (s.pendingByBooking[bookingId] ?? []).filter((p) => p.tempId !== tempId),
      },
    })),
  markFailed: (bookingId, tempId, error) =>
    set((s) => ({
      pendingByBooking: {
        ...s.pendingByBooking,
        [bookingId]: (s.pendingByBooking[bookingId] ?? []).map((p) =>
          p.tempId === tempId ? { ...p, status: 'failed' as const, error } : p,
        ),
      },
    })),
  setInterrupted: (bookingId, rec) =>
    set((s) => ({
      interruptedByBooking: { ...s.interruptedByBooking, [bookingId]: rec },
    })),
}));

const PLAYED_KEY = 'voice_note_played_v1';
let playedCache: Set<string> | null = null;

async function loadPlayed(): Promise<Set<string>> {
  if (playedCache) return playedCache;
  try {
    const raw = await AsyncStorage.getItem(PLAYED_KEY);
    playedCache = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    playedCache = new Set();
  }
  return playedCache;
}

export async function hasPlayed(messageId: string): Promise<boolean> {
  return (await loadPlayed()).has(messageId);
}

export async function markPlayed(messageId: string): Promise<void> {
  const played = await loadPlayed();
  if (played.has(messageId)) return;
  played.add(messageId);
  try {
    // Cap the persisted set so it can't grow unbounded over years of chat;
    // dropping the OLDEST entries only ever re-shows a dot on ancient notes.
    const list = [...played];
    await AsyncStorage.setItem(PLAYED_KEY, JSON.stringify(list.slice(-500)));
  } catch {
    // Persistence is best-effort; the in-memory set still clears the dot
    // for this session.
  }
}
