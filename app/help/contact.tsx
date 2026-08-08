import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { Text } from '../../lib/text';
import { submitContentReport } from '../../lib/api';
import { colors, spacing } from '../../lib/theme';

/**
 * Contact Support — the same /v1/reports pipeline as Report a Problem,
 * category 'support', so messages land in the admin portal's moderation
 * queue instead of nowhere. "Send message" used to run router.back(): the
 * user's text was discarded and the dismissal read as success.
 *
 * Same rule as the chat fixes: a failed send NEVER destroys what was typed.
 * Fields clear only after the server confirms the row.
 */
export default function Contact() {
  const router = useRouter();
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const send = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await submitContentReport(
      'support',
      `Subject: ${subject.trim()}\n\n${message.trim()}`,
    );
    setSending(false);
    if (!result || 'error' in result) {
      // Keep subject and message exactly as typed — the user retries, not retypes.
      setError(result?.error ?? "Couldn't send — check your connection and try again.");
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Contact support" />
        <View style={styles.doneWrap}>
          <Text style={styles.doneTitle}>Message sent</Text>
          <Text style={styles.doneBody}>
            Our team reads every message and replies by email, usually within a day.
          </Text>
          <Button title="Done" onPress={() => router.back()} style={{ marginTop: 22, alignSelf: 'stretch' }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Contact support" />
      <ScrollView contentContainerStyle={styles.body}>
        <TextField label="Subject" value={subject} onChangeText={setSubject} />
        <TextField
          label="How can we help?"
          value={message}
          onChangeText={setMessage}
          multiline
          style={{ height: 130, paddingTop: 14, textAlignVertical: 'top' }}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title={sending ? 'Sending…' : 'Send message'}
          disabled={!subject.trim() || !message.trim() || sending}
          loading={sending}
          onPress={send}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40, gap: 16 },
  error: { fontSize: 12.5, fontWeight: '600', color: colors.error },
  doneWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.screenX, paddingBottom: 80 },
  doneTitle: { fontSize: 21, fontWeight: '800', color: colors.ink, textAlign: 'center', letterSpacing: -0.3 },
  doneBody: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10 },
});
