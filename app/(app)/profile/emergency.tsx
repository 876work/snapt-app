import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { InfoBanner } from '../../../components/ui/Misc';
import { TextField } from '../../../components/ui/TextField';
import { Button } from '../../../components/ui/Button';
import { colors, spacing } from '../../../lib/theme';

// Emergency contact storage — session sharing goes out via SMS (Twilio) to
// this contact, not as a push (§11). SMS wiring is Phase 4 backend work.
export default function EmergencyContacts() {
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');

  return (
    <View style={styles.root}>
      <ScreenHeader title="Emergency contacts" />
      <ScrollView contentContainerStyle={styles.body}>
        <InfoBanner text="During an in-person session you can share your live session details — meeting point, time window, and who you're meeting — with this contact by text message." />
        <View style={{ gap: 16, marginTop: 18 }}>
          <TextField label="Contact name" value={name} onChangeText={setName} />
          <TextField
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+1 758 ..."
          />
          <Button title="Save contact" disabled={!name || phone.length < 7} onPress={() => {}} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
});
