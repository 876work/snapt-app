import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  /** Stops whatever is currently playing, then records the new claimant. */
  claim: (id: string, stop: () => void) => void;
  /** Only clears if `id` still holds the floor (a later claim already replaced it). */
  release: (id: string) => void;
}

let currentStop: (() => void) | null = null;

export const useVoicePlayback = create<VoicePlaybackState>((set, get) => ({
  playingId: null,
  claim: (id, stop) => {
    if (get().playingId !== id && currentStop) {
      try {
        currentStop();
      } catch {
        // A dead player's stop() failing must not block the new one.
      }
    }
    currentStop = stop;
    set({ playingId: id });
  },
  release: (id) => {
    if (get().playingId === id) {
      currentStop = null;
      set({ playingId: null });
    }
  },
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
