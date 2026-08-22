import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../lib/text';
import { colors } from '../../lib/theme';

/**
 * "THIS IS BEYOND THE ORDER" — a signal to Snapt, not a stop button.
 *
 * A creator facing a revision request outside what was booked had two
 * options: do it, or ignore it. This is the third. It deliberately changes
 * NOTHING about the round — it stays open, it stays deliverable, and the
 * Deliver panel beside it is untouched. A creator who flags a request can
 * still go on and deliver it, and the copy says so, because a control that
 * looks like a refusal would be used as one.
 *
 * THE CLIENT IS NEVER TOLD and sees nothing. That is enforced on the server
 * (no notification, and no target_user_id for the moderation automation to
 * act on), not by this screen keeping quiet — but the creator is told that
 * it is enforced, because someone deciding whether to flag needs to know it
 * will not start an argument.
 *
 * NOT A NEGOTIATION SURFACE. No amount, no counter-offer, no reply path, no
 * price of any kind: standardised pricing is a locked rule. This files a
 * sentence and nothing else.
 *
 * Lives in one file because both creator screens show revision requests and
 * this codebase has been bitten repeatedly by the same control existing in
 * two copies that drift.
 */
export function RevisionFlag({
  bookingId,
  revisionId,
  flagged,
  onFlagged,
}: {
  bookingId: string;
  revisionId: string;
  flagged: boolean;
  /** Marks the request flagged locally so the control cannot be offered twice. */
  onFlagged: (revisionId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const submit = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const api = await import('../../lib/api');
      const r = await api.flagRevisionApi(bookingId, revisionId, text.trim());
      if (!r.ok) {
        // The server's own sentence — "already flagged", "not your booking" —
        // shown rather than a generic failure.
        setError(r.error);
        return;
      }
      onFlagged(revisionId);
      setOpen(false);
      setText('');
    } catch (err) {
      // flagRevisionApi returns its failures, so a throw here is unexpected:
      // reported, and still shown.
      const { captureHandledError } = await import('../../lib/sentry');
      captureHandledError(err, 'revisionFlag:submit');
      setError("Couldn't file that just now — try again.");
    } finally {
      setSending(false);
    }
  };

  if (flagged) {
    return (
      <Text style={styles.done}>Flagged for review — you can still deliver this round.</Text>
    );
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6}>
        <Text style={styles.link}>This is beyond the order</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.box}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Briefly, what puts this beyond the order?"
        placeholderTextColor="#9A9A9A"
        multiline
        style={styles.input}
      />
      <Text style={styles.hint}>
        This goes to Snapt only — the client is not told and sees nothing. It does not pause
        anything, and you can still deliver this round.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => {
            setOpen(false);
            setText('');
            setError(null);
          }}
          style={[styles.btn, styles.cancel]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => void submit()}
          disabled={text.trim().length < 10 || sending}
          style={[styles.btn, styles.send, (text.trim().length < 10 || sending) && { opacity: 0.4 }]}
        >
          <Text style={styles.sendLabel}>{sending ? 'Sending…' : 'Send to Snapt'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.grey,
    textDecorationLine: 'underline',
    marginTop: 8,
  },
  done: { fontSize: 12, fontWeight: '700', color: '#8A7530', marginTop: 8 },
  box: { marginTop: 8, gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    fontSize: 13,
    color: colors.ink,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  hint: { fontSize: 11, color: colors.grey, lineHeight: 15 },
  error: { fontSize: 12, color: colors.error, fontWeight: '600' },
  btn: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cancel: { borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  cancelLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  send: { backgroundColor: colors.ink },
  sendLabel: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
