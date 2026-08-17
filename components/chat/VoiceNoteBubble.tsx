import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';
import { captureHandledError } from '../../lib/sentry';
import { fetchVoiceUrl } from '../../lib/voiceNotes';
import { hasPlayed, markPlayed, useVoicePlayback } from '../../lib/voicePlayback';

/**
 * Playback half of voice notes — self-contained for the same reason as the
 * recorder: the thread redesign restyles this bubble, it does not rebuild
 * the player.
 *
 * Matches the approved mockup: play/pause, static waveform, duration, and
 * an unplayed dot that clears on first play. One note plays at a time
 * (lib/voicePlayback). Playback failure is a visible message with retry —
 * never a frozen button.
 *
 * Audio routes to the SPEAKER. Earpiece-on-raise needs a proximity sensor
 * subscription (expo-sensors, not installed) — not "cheap" per the spec's
 * own bar, so deliberately speaker-only.
 */

/** Deterministic pseudo-waveform: stable per message, same on both ends. */
function waveformHeights(seed: string, bars = 24): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619) >>> 0;
    out.push(7 + (h % 15));
  }
  return out;
}

function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function PlayIcon({ paused }: { paused: boolean }) {
  return paused ? (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Rect x={6} y={4.5} width={4} height={15} rx={1.4} fill={colors.ink} />
      <Rect x={14} y={4.5} width={4} height={15} rx={1.4} fill={colors.ink} />
    </Svg>
  ) : (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5.5v13l11-6.5-11-6.5z" fill={colors.ink} />
    </Svg>
  );
}

function Waveform({ seed, progress }: { seed: string; progress: number }) {
  const bars = React.useMemo(() => waveformHeights(seed), [seed]);
  const filled = Math.round(progress * bars.length);
  return (
    <View style={styles.wave}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={[styles.waveBar, { height: h }, i < filled && styles.waveBarPlayed]}
        />
      ))}
    </View>
  );
}

export function VoiceNoteBubble({
  bookingId,
  messageId,
  audioPath,
  durationSeconds,
  mine,
}: {
  bookingId: string;
  messageId: string;
  audioPath: string;
  durationSeconds: number;
  mine: boolean;
}) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [position, setPosition] = React.useState(0);
  const [unplayed, setUnplayed] = React.useState(false);
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const claim = useVoicePlayback((s) => s.claim);
  const release = useVoicePlayback((s) => s.release);

  React.useEffect(() => {
    // The dot marks a note THEY sent that this device has never played.
    if (!mine) {
      let alive = true;
      void hasPlayed(messageId).then((played) => alive && setUnplayed(!played));
      return () => {
        alive = false;
      };
    }
  }, [messageId, mine]);

  React.useEffect(
    () => () => {
      // Unmount: stop and free the native player, release the floor.
      try {
        playerRef.current?.remove();
      } catch (err) {
        captureHandledError(err, 'voiceBubble:release');
      }
      playerRef.current = null;
      release(messageId);
    },
    [messageId, release],
  );

  const stopToPause = React.useCallback(() => {
    try {
      playerRef.current?.pause();
    } catch (err) {
      captureHandledError(err, 'voiceBubble:pause');
    }
    setState('idle');
  }, []);

  const play = async () => {
    // First play clears the dot and records it, win or lose from here —
    // the user has acted on the note.
    if (unplayed) {
      setUnplayed(false);
      void markPlayed(messageId);
    }
    let player = playerRef.current;
    if (!player) {
      setState('loading');
      const url = await fetchVoiceUrl(bookingId, audioPath);
      if (!url) {
        setState('error');
        return;
      }
      try {
        player = createAudioPlayer({ uri: url }, { updateInterval: 250 });
        player.addListener('playbackStatusUpdate', (status) => {
          // Load and playback failures arrive HERE, asynchronously — an
          // expired URL, a missing object or a dropped connection never
          // throws from play(). Ignoring status.error rendered every such
          // failure as an eternal silent "playing" state with the retry
          // unreachable — the failure-looks-like-success class, again.
          if (status.error) {
            captureHandledError(new Error(`voice playback: ${status.error}`), 'voiceBubble:status-error');
            try {
              playerRef.current?.remove();
            } catch {
              /* already dead — replacing it regardless */
            }
            playerRef.current = null;
            release(messageId);
            setPosition(0);
            setState('error');
            return;
          }
          setPosition(status.currentTime);
          if (status.didJustFinish) {
            /**
             * PAUSE BEFORE REWINDING — this ordering is the whole fix.
             *
             * Reaching the end does not clear ExoPlayer's `playWhenReady`:
             * STATE_ENDED keeps the intent to play, and expo-audio's
             * seekTo() is a bare `player.seekTo(ms)` with no guard
             * (Playable.kt:31). So rewinding a FINISHED player moved it
             * back into a playable state with the play intent still set,
             * and the note started over — while this handler had already
             * set the UI to idle, so the button showed Play over audio that
             * was really running and Pause became unreachable.
             *
             * pause() clears playWhenReady, so the seek lands on a player
             * that is genuinely stopped at zero. Harmless on iOS, where
             * AVPlayer's rate is already 0 at the end.
             */
            try {
              playerRef.current?.pause();
            } catch (err) {
              captureHandledError(err, 'voiceBubble:pause-at-end');
            }
            void playerRef.current?.seekTo(0).catch((err: unknown) => {
              captureHandledError(err, 'voiceBubble:rewind-at-end');
            });
            setPosition(0);
            release(messageId);
            setState('idle');
            return;
          }
          /**
           * THE CONTROL FOLLOWS REAL PLAYBACK, not what we intended.
           *
           * `state` used to be set only from our own call sites, so once it
           * disagreed with the player nothing could bring the two back
           * together. Reading it back from the status is what stops the
           * button and the audio diverging again.
           *
           * Gated on a settled player: while loading or buffering the
           * reported `playing` flag is intent rather than fact
           * (AudioPlayer.kt:199 returns intendedPlayingState mid-buffer),
           * and acting on it would flicker the button at every start.
           */
          if (status.isLoaded && !status.isBuffering) {
            setState((prev) =>
              prev === 'loading' || prev === 'error' ? prev : status.playing ? 'playing' : 'idle',
            );
          }
        });
        playerRef.current = player;
      } catch (err) {
        captureHandledError(err, 'voiceBubble:create-player');
        setState('error');
        return;
      }
    }
    try {
      // Speaker playback, audible in silent mode (a tapped play IS intent).
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.play();
      // Claim only once playback actually started — a failed play must not
      // evict whoever is legitimately holding the floor.
      claim(messageId, stopToPause);
      setState('playing');
    } catch (err) {
      captureHandledError(err, 'voiceBubble:play');
      release(messageId);
      setState('error');
    }
  };

  const toggle = () => {
    if (state === 'playing') {
      stopToPause();
      release(messageId);
    } else if (state !== 'loading') {
      void play();
    }
  };

  const duration = durationSeconds || playerRef.current?.duration || 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  if (state === 'error') {
    return (
      <Pressable
        onPress={() => {
          // Full retry: drop the dead player and mint a fresh URL.
          try {
            playerRef.current?.remove();
          } catch {
            /* replacing it regardless */
          }
          playerRef.current = null;
          setState('idle');
          void play();
        }}
        style={styles.errorWrap}
        accessibilityLabel="Voice note failed to play — tap to retry"
      >
        <Text style={styles.errorText}>Couldn’t play this voice note — tap to retry.</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={toggle}
      style={styles.row}
      accessibilityLabel={state === 'playing' ? 'Pause voice note' : 'Play voice note'}
    >
      <View style={styles.playButton}>
        {state === 'loading' ? (
          <ActivityIndicator size="small" color={colors.ink} />
        ) : (
          <PlayIcon paused={state === 'playing'} />
        )}
      </View>
      <Waveform seed={messageId} progress={state === 'playing' || position > 0 ? progress : 0} />
      <Text style={styles.duration}>
        {formatClock(state === 'playing' ? Math.max(0, duration - position) : duration)}
      </Text>
      {unplayed && <View style={styles.unplayedDot} />}
    </Pressable>
  );
}

/**
 * A voice note that is still leaving the phone (or failed to). Rendered by
 * ChatThread for optimistic sends; swapped for the real bubble once the row
 * is confirmed. Failed uploads get Retry + Delete — the same treatment as
 * failed text, never a bubble that quietly looks sent.
 */
export function PendingVoiceNote({
  durationSeconds,
  status,
  error,
  onRetry,
  onDelete,
}: {
  durationSeconds: number;
  status: 'uploading' | 'failed';
  error?: string;
  onRetry: () => void;
  onDelete: () => void;
}) {
  return (
    <View>
      <View style={[styles.row, status === 'failed' && styles.rowFailed]}>
        <View style={styles.playButton}>
          {status === 'uploading' ? (
            <ActivityIndicator size="small" color={colors.ink} />
          ) : (
            <Text style={styles.failedGlyph}>!</Text>
          )}
        </View>
        <Waveform seed={`pending-${durationSeconds}`} progress={0} />
        <Text style={styles.duration}>{formatClock(durationSeconds)}</Text>
      </View>
      {status === 'failed' && (
        <View style={styles.failedRow}>
          <Text style={styles.failedText}>{error ?? 'Not sent.'}</Text>
          <Pressable onPress={onRetry} hitSlop={8}>
            <Text style={styles.failedAction}>Retry</Text>
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={8}>
            <Text style={[styles.failedAction, { color: '#A3261F' }]}>Delete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 180 },
  rowFailed: { opacity: 0.75 },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  waveBar: { width: 2.5, borderRadius: 2, backgroundColor: '#CFC9BC' },
  waveBarPlayed: { backgroundColor: colors.yellowDark },
  duration: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.grey,
    fontVariant: ['tabular-nums'],
  },
  unplayedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.yellowDark },
  errorWrap: { paddingVertical: 2 },
  errorText: { fontSize: 13, color: '#A3261F' },
  failedGlyph: { fontSize: 16, fontWeight: '900', color: '#A3261F' },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  failedText: { fontSize: 12.5, color: '#A3261F', flexShrink: 1 },
  failedAction: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
});
