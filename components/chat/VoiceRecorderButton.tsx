import React from 'react';
import { Alert, AppState, Linking, Modal, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';
import { captureHandledError } from '../../lib/sentry';
import { MAX_VOICE_SECONDS } from '../../lib/voiceNotes';

/**
 * Recording half of voice notes — deliberately self-contained so the thread
 * redesign can restyle or re-home it without touching recording logic.
 *
 * Two surfaces over one core:
 *  - `VoiceRecorderButton`: the composer mic. Hold to record, release to
 *    send, slide left to cancel.
 *  - `VoiceRecordSheet`: the attachment-tray path. Tap to start/stop with
 *    an explicit Send/Discard step (also the landing state for interrupted
 *    recordings — nothing is ever silently lost).
 *
 * Output is a finished FILE handed to `onRecorded`; upload/insert belong to
 * the caller (lib/voiceNotes.ts), not here.
 */

export interface RecordedVoiceNote {
  uri: string;
  durationSec: number;
  /** True when a call/backgrounding ended the recording, not the user. */
  interrupted?: boolean;
}

/** AAC in .m4a, mono, speech bitrate — small files that play on both platforms. */
const VOICE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  // Required by the type; the app has no web target (kept type-honest).
  web: { mimeType: 'audio/mp4', bitsPerSecond: 64000 },
};

const CANCEL_DRAG_PX = -70;

export async function deleteRecordingFile(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    const FS = await import('expo-file-system');
    new FS.File(uri).delete();
  } catch (err) {
    // The file sits in the app cache and the OS reclaims it; report so a
    // systematic failure is visible, but never block the UI on cleanup.
    captureHandledError(err, 'voiceRecorder:delete-temp');
  }
}

/**
 * Permission gate, following lib/pickMedia.ts exactly: while the OS will
 * still ask, explain and re-ask; once it won't, the ONLY honest button is
 * one that opens system settings. Returns true when recording may start.
 * Never a silent dead button.
 */
async function ensureMicPermission(): Promise<boolean> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain) {
      const asked = await requestRecordingPermissionsAsync();
      if (asked.granted) return true;
      if (asked.canAskAgain) {
        Alert.alert(
          'Microphone access needed',
          'Snapt uses the microphone to record voice notes in chat. Try again and allow microphone access.',
          [{ text: 'OK' }],
        );
        return false;
      }
    }
    Alert.alert(
      'Microphone access is off',
      'Snapt can’t record voice notes without the microphone. Turn it on in Settings.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ],
    );
    return false;
  } catch (err) {
    captureHandledError(err, 'voiceRecorder:permission');
    Alert.alert('Microphone check failed', 'Couldn’t check microphone access — try again.');
    return false;
  }
}

/** Shared recording core: start/stop/cancel + cap + interruption handling. */
function useVoiceRecording(onRecorded: (rec: RecordedVoiceNote) => void) {
  const recorder = useAudioRecorder(VOICE_RECORDING, (status) => {
    // A call or a media-services reset ends the recording FROM the OS side.
    // If bytes exist, hand them over marked interrupted — the caller offers
    // send/discard. Never silently lose a partial recording.
    if (status.hasError && recordingRef.current) {
      void finish('interrupt');
    }
  });
  const recorderState = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = React.useState(false);
  const recordingRef = React.useRef(false);
  const stoppingRef = React.useRef(false);
  const startingRef = React.useRef(false);
  const startedAtRef = React.useRef(0);
  /**
   * The user's CURRENT intent to be recording. Set by the gesture/button
   * BEFORE start() is called; cleared by every finish(), including ones
   * that arrive while start() is still awaiting the permission dialog or
   * the audio session. start() re-checks it after those awaits — without
   * this, a release that beat the (up to seconds long, on first use with
   * the OS permission dialog) start latency was swallowed by the
   * not-recording guard, and the mic came up hot with nobody holding it,
   * recording the room until the 2-minute cap auto-sent it.
   */
  const wantRef = React.useRef(false);

  const start = React.useCallback(async (): Promise<boolean> => {
    if (recordingRef.current || startingRef.current) return false;
    startingRef.current = true;
    try {
      if (!(await ensureMicPermission())) return false;
      if (!wantRef.current) return false; // released while the dialog was up
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!wantRef.current) {
        // The hold ended (or the sheet closed) while we were preparing.
        // Never record with nobody watching.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        return false;
      }
      recorder.record();
      startedAtRef.current = Date.now();
      stoppingRef.current = false;
      recordingRef.current = true;
      setRecording(true);
      return true;
    } catch (err) {
      captureHandledError(err, 'voiceRecorder:start');
      Alert.alert('Recording failed', 'Couldn’t start recording — try again.');
      return false;
    } finally {
      startingRef.current = false;
    }
  }, [recorder]);

  const finish = React.useCallback(
    async (mode: 'send' | 'cancel' | 'interrupt') => {
      // Clear intent FIRST: a finish landing mid-start is how the start()
      // guards above learn the gesture is over.
      wantRef.current = false;
      if (!recordingRef.current || stoppingRef.current) return;
      stoppingRef.current = true;
      recordingRef.current = false;
      // Duration from wall clock — recorderState lags by its polling
      // interval and resets on stop.
      const durationSec = Math.min(MAX_VOICE_SECONDS, (Date.now() - startedAtRef.current) / 1000);
      let uri: string | null = null;
      try {
        await recorder.stop();
        uri = recorder.uri;
      } catch (err) {
        captureHandledError(err, 'voiceRecorder:stop');
      }
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch (err) {
        captureHandledError(err, 'voiceRecorder:audio-mode-reset');
      }
      setRecording(false);
      if (mode === 'cancel' || !uri || durationSec < 1) {
        // Slide-to-cancel and sub-second taps discard: nothing uploads.
        await deleteRecordingFile(uri);
        return;
      }
      onRecorded({ uri, durationSec: Math.round(durationSec), interrupted: mode === 'interrupt' });
    },
    [onRecorded, recorder],
  );

  // Hard cap: stop and send at MAX_VOICE_SECONDS — release semantics, the
  // recording simply ends where the limit is.
  const elapsedSec = recording ? Math.min(MAX_VOICE_SECONDS, recorderState.durationMillis / 1000) : 0;
  React.useEffect(() => {
    if (recording && recorderState.durationMillis >= MAX_VOICE_SECONDS * 1000) {
      void finish('send');
    }
  }, [recording, recorderState.durationMillis, finish]);

  // Backgrounding ends the recording but keeps the bytes (send-or-discard).
  React.useEffect(() => {
    if (!recording) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') void finish('interrupt');
    });
    return () => sub.remove();
  }, [recording, finish]);

  return { recording, elapsedSec, start, finish, wantRef };
}

function formatClock(totalSec: number): string {
  const s = Math.floor(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function MicIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={9} y={3} width={6} height={11} rx={3} stroke={color} strokeWidth={1.8} />
      <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Timer + countdown. The last 30 seconds count down visibly, in warning red. */
function RecordingTimer({ elapsedSec }: { elapsedSec: number }) {
  const remaining = MAX_VOICE_SECONDS - elapsedSec;
  return (
    <View style={styles.timerWrap}>
      <View style={styles.redDot} />
      <Text style={styles.timerText}>{formatClock(elapsedSec)}</Text>
      {remaining <= 30 && (
        <Text style={styles.countdown}>{Math.max(0, Math.ceil(remaining))}s left</Text>
      )}
    </View>
  );
}

/**
 * The composer mic. Hold to record (the row swaps to a timer + cancel
 * hint), release to send, slide left to cancel. Parent supplies layout via
 * `expanded` styling — while recording this stretches to fill the row.
 */
export function VoiceRecorderButton({
  disabled,
  onRecorded,
  onRecordingChange,
}: {
  disabled?: boolean;
  onRecorded: (rec: RecordedVoiceNote) => void;
  onRecordingChange?: (recording: boolean) => void;
}) {
  const { recording, elapsedSec, start, finish, wantRef } = useVoiceRecording(onRecorded);
  const [cancelArmed, setCancelArmed] = React.useState(false);
  const cancelArmedRef = React.useRef(false);
  // The PanResponder below is created ONCE; anything it reads must come
  // through refs or it is frozen at mount-time values. `disabled` used to be
  // captured directly — a mic greyed out by a mid-session thread change
  // still recorded, and a re-enabled one stayed dead.
  const disabledRef = React.useRef(!!disabled);
  disabledRef.current = !!disabled;
  const startRef = React.useRef(start);
  startRef.current = start;
  const finishRef = React.useRef(finish);
  finishRef.current = finish;

  React.useEffect(() => onRecordingChange?.(recording), [recording, onRecordingChange]);

  const pan = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: () => {
        cancelArmedRef.current = false;
        setCancelArmed(false);
        // Intent first, then start — a release during start()'s awaits
        // clears the intent and start() aborts instead of going hot.
        wantRef.current = true;
        void startRef.current();
      },
      onPanResponderMove: (_e, g) => {
        const armed = g.dx < CANCEL_DRAG_PX;
        if (armed !== cancelArmedRef.current) {
          cancelArmedRef.current = armed;
          setCancelArmed(armed);
        }
      },
      onPanResponderRelease: () => {
        void finishRef.current(cancelArmedRef.current ? 'cancel' : 'send');
      },
      // The system stole the gesture (navigation, incoming call sheet):
      // treat as interruption, not silent loss.
      onPanResponderTerminate: () => {
        void finishRef.current('interrupt');
      },
    }),
  ).current;

  if (recording) {
    return (
      <View style={[styles.recordingRow, cancelArmed && styles.recordingRowCancel]} {...pan.panHandlers}>
        <RecordingTimer elapsedSec={elapsedSec} />
        <Text style={[styles.cancelHint, cancelArmed && styles.cancelHintArmed]}>
          {cancelArmed ? 'Release to cancel' : '‹ Slide left to cancel'}
        </Text>
        <View style={[styles.micButton, styles.micButtonLive]}>
          <MicIcon color="#fff" />
        </View>
      </View>
    );
  }

  return (
    <View
      {...pan.panHandlers}
      style={[styles.micButton, disabled && styles.micButtonDisabled]}
      accessibilityLabel="Hold to record a voice note"
    >
      <MicIcon color={disabled ? '#B9B9B9' : colors.ink} />
    </View>
  );
}

/**
 * Attachment-tray recorder: tap to start, tap to stop, then an explicit
 * Send / Discard choice. Also rendered by ChatThread as the landing state
 * for interrupted hold-recordings (`pending` prop) — same two buttons, so a
 * partial recording is always either sent on purpose or discarded on
 * purpose.
 */
export function VoiceRecordSheet({
  visible,
  onClose,
  onSend,
  pending,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (rec: RecordedVoiceNote) => void;
  /** An already-finished recording awaiting the send/discard decision. */
  pending?: RecordedVoiceNote | null;
}) {
  const [done, setDone] = React.useState<RecordedVoiceNote | null>(null);
  // Guards the closed-mid-start ghost: if the sheet was dismissed while
  // start() was still awaiting, the recording that finishes later must be
  // discarded, not stashed to ambush the next open as "Voice note ready".
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;
  const onRecorded = React.useCallback((rec: RecordedVoiceNote) => {
    if (!visibleRef.current) {
      void deleteRecordingFile(rec.uri);
      return;
    }
    setDone(rec);
  }, []);
  const { recording, elapsedSec, start, finish, wantRef } = useVoiceRecording(onRecorded);
  const settled = pending ?? done;

  const discard = async () => {
    // finish() unconditionally: it clears the recording INTENT too, so a
    // start() still in flight aborts instead of leaving a hot mic behind a
    // closed sheet.
    await finish('cancel');
    if (settled) await deleteRecordingFile(settled.uri);
    setDone(null);
    onClose();
  };
  const send = () => {
    if (!settled) return;
    onSend(settled);
    setDone(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void discard()}>
      <Pressable style={styles.sheetBackdrop} onPress={() => void discard()}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>
            {settled
              ? settled.interrupted
                ? 'Recording interrupted'
                : 'Voice note ready'
              : recording
                ? 'Recording…'
                : 'Voice note'}
          </Text>
          {settled ? (
            <>
              <Text style={styles.sheetBody}>
                {settled.interrupted
                  ? `Your recording stopped at ${formatClock(settled.durationSec)} — send what you have, or discard it.`
                  : `${formatClock(settled.durationSec)} recorded.`}
              </Text>
              <View style={styles.sheetActions}>
                <Pressable style={styles.sheetSecondary} onPress={() => void discard()}>
                  <Text style={styles.sheetSecondaryLabel}>Discard</Text>
                </Pressable>
                <Pressable style={styles.sheetPrimary} onPress={send}>
                  <Text style={styles.sheetPrimaryLabel}>Send</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              {recording ? (
                <RecordingTimer elapsedSec={elapsedSec} />
              ) : (
                <Text style={styles.sheetBody}>Up to 2 minutes. Tap to start.</Text>
              )}
              <View style={styles.sheetActions}>
                <Pressable style={styles.sheetSecondary} onPress={() => void discard()}>
                  <Text style={styles.sheetSecondaryLabel}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.sheetPrimary, recording && styles.sheetStop]}
                  onPress={() => {
                    if (recording) {
                      void finish('send');
                    } else {
                      // Intent before start — same race guard as the
                      // composer hold (Cancel clears it via finish()).
                      wantRef.current = true;
                      void start();
                    }
                  }}
                >
                  <Text style={[styles.sheetPrimaryLabel, recording && { color: '#fff' }]}>
                    {recording ? 'Stop' : 'Start recording'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonDisabled: { backgroundColor: '#EFEBE3' },
  micButtonLive: { backgroundColor: '#D23A32' },
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 2,
  },
  recordingRowCancel: { opacity: 0.85 },
  timerWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  redDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#D23A32' },
  timerText: { fontSize: 14, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
  countdown: { fontSize: 12.5, fontWeight: '800', color: '#D23A32', fontVariant: ['tabular-nums'] },
  cancelHint: { fontSize: 12.5, color: colors.grey, flexShrink: 1 },
  cancelHintArmed: { color: '#D23A32', fontWeight: '700' },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,18,12,0.45)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 18,
  },
  sheet: {
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 12,
    marginBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  sheetBody: { fontSize: 13.5, color: colors.grey, lineHeight: 19 },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  sheetPrimary: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: colors.yellow,
  },
  sheetStop: { backgroundColor: '#D23A32' },
  sheetPrimaryLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  sheetSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: '#F1EEE7',
  },
  sheetSecondaryLabel: { fontSize: 14, fontWeight: '700', color: colors.grey },
});
