import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { TextField } from '../../components/ui/TextField';
import { Button } from '../../components/ui/Button';
import { colors, spacing } from '../../lib/theme';

export default function Contact() {
  const router = useRouter();
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
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
        <Button
          title="Send message"
          disabled={!subject || !message}
          onPress={() => router.back()}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40, gap: 16 },
});
