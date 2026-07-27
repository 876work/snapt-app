import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Card, InfoBanner } from '../../../components/ui/Misc';
import { colors, spacing } from '../../../lib/theme';

// Intentionally minimal per Don's direction (§13): four toggles plus a
// non-toggleable critical bucket covering financial + safety/dispute alerts.
const TOGGLES = ['Order updates', 'Messages', 'Booking reminders', 'Promotions & offers'];

export default function NotificationSettings() {
  const [state, setState] = React.useState<Record<string, boolean>>(
    Object.fromEntries(TOGGLES.map((t) => [t, true])),
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title="Notification settings" />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={{ paddingVertical: 4, paddingHorizontal: 0 }}>
          {TOGGLES.map((t, i) => (
            <View key={t} style={[styles.row, i < TOGGLES.length - 1 && styles.rowBorder]}>
              <Text style={styles.rowLabel}>{t}</Text>
              <Switch
                value={state[t]}
                onValueChange={(v) => setState((s) => ({ ...s, [t]: v }))}
                trackColor={{ true: colors.yellow }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </Card>
        <View style={{ marginTop: 14 }}>
          <InfoBanner text="Critical account and security alerts — including payments, refunds, payouts, safety, and dispute updates — are always on and can't be disabled." />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
});
