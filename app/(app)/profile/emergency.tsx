import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../lib/text';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { InfoBanner } from '../../../components/ui/Misc';
import { TextField } from '../../../components/ui/TextField';
import { Button } from '../../../components/ui/Button';
import { colors, spacing } from '../../../lib/theme';

// Emergency contact storage — EMAIL is the primary field: "Share my session"
// sends meeting details to this contact by email (Resend). Snapt uses no SMS
// anywhere; phone is optional display/contact info only.
export default function EmergencyContacts() {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [status, setStatus] = React.useState<string | null>(null);

  const save = async () => {
    setStatus(null);
    const { supabase } = await import('../../../lib/supabase');
    if (supabase) {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const { error } = await supabase.from('emergency_contacts').insert({
          user_id: auth.user.id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
        });
        if (error) {
          setStatus("Couldn't save the contact — try again.");
          return;
        }
      }
    }
    setStatus(`${name.trim()} saved as your emergency contact.`);
    setName('');
    setEmail('');
    setPhone('');
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Emergency contacts" />
      <ScrollView contentContainerStyle={styles.body}>
        <InfoBanner text="During an in-person session you can share your live session details — meeting point, time window, and who you're meeting — with this contact by email." />
        <View style={{ gap: 16, marginTop: 18 }}>
          <TextField label="Contact name" value={name} onChangeText={setName} />
          <TextField
            label="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="Where session details are sent"
          />
          <TextField
            label="Phone number (optional)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+1 758 ..."
          />
          {status ? <Text style={styles.status}>{status}</Text> : null}
          <Button title="Save contact" disabled={!name.trim() || !email.includes('@')} onPress={save} />
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
