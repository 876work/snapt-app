import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../../lib/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { InfoBanner } from '../../../../components/ui/Misc';
import { TextField } from '../../../../components/ui/TextField';
import { Button } from '../../../../components/ui/Button';
import { colors, spacing } from '../../../../lib/theme';

// Dispute evidence submission (§10): written statements during the 72-hour
// window. Inserts go through Supabase RLS ("parties submit evidence").
// File/photo evidence attachments come with the fuller Phase 5 portal work.
export default function DisputeEvidence() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = React.useState('');
  const [status, setStatus] = React.useState<string | null>(null);

  const submit = async () => {
    setStatus(null);
    const { supabase } = await import('../../../../lib/supabase');
    if (supabase && id) {
      const { data: auth } = await supabase.auth.getUser();
      const { data: dispute } = await supabase
        .from('disputes')
        .select('id, status, evidence_deadline_at')
        .eq('booking_id', id)
        .not('status', 'in', '(resolved,closed)')
        .maybeSingle();
      if (!dispute) {
        setStatus('No open dispute on this booking.');
        return;
      }
      if (dispute.evidence_deadline_at && Date.parse(dispute.evidence_deadline_at) < Date.now()) {
        setStatus('The 72-hour evidence window has closed — the review proceeds on submitted evidence.');
        return;
      }
      const { error } = await supabase.from('dispute_evidence').insert({
        dispute_id: dispute.id,
        submitted_by: auth.user?.id,
        kind: 'text',
        content: text.trim(),
      });
      if (error) {
        setStatus("Couldn't submit — try again.");
        return;
      }
    }
    setText('');
    setStatus('Evidence submitted — the review team will consider it.');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Add evidence" />
      <ScrollView contentContainerStyle={styles.body}>
        <InfoBanner text="Describe what happened as specifically as you can — times, what was agreed, what was delivered. Chat logs, check-in records, and delivered content are already part of the review automatically." />
        <View style={{ gap: 16, marginTop: 18 }}>
          <TextField
            label="Your account of events"
            value={text}
            onChangeText={setText}
            multiline
            numberOfLines={6}
            placeholder="What happened, in your words"
          />
          {status ? <Text style={styles.status}>{status}</Text> : null}
          <Button title="Submit evidence" disabled={text.trim().length < 10} onPress={submit} />
          <Button title="Back to booking" variant="ghost" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  status: { fontSize: 13, fontWeight: '600', color: colors.grey },
});
