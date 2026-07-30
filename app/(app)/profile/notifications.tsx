import React from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../../../lib/text';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Card, InfoBanner } from '../../../components/ui/Misc';
import { getDeliveryStatus, enablePush, disablePush, DeliveryStatus } from '../../../lib/push';
import { colors, spacing } from '../../../lib/theme';

// §13: four toggles plus a non-toggleable critical bucket (payments, safety,
// disputes). Toggles persist to profiles.notification_prefs and the server
// enforces them on the push channel. The push section handles the "signed up
// before push existed / tapped Not now" case — and the OS-denied case, where
// the dialog can't be shown again and only system settings can re-enable.
const TOGGLES: { label: string; key: string }[] = [
  { label: 'Order updates', key: 'order_updates' },
  { label: 'Messages', key: 'messages' },
  { label: 'Booking reminders', key: 'booking_reminders' },
  { label: 'Promotions & offers', key: 'promotions' },
];

export default function NotificationSettings() {
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>(
    Object.fromEntries(TOGGLES.map((t) => [t.key, true])),
  );
  const [push, setPush] = React.useState<DeliveryStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refreshPush = React.useCallback(() => {
    getDeliveryStatus().then(setPush);
  }, []);

  React.useEffect(() => {
    refreshPush();
    // Coming back from system settings re-checks permission and, if the user
    // enabled us there, registers the token right away.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refreshPush();
        import('../../../lib/push').then((p) => p.registerIfGranted());
      }
    });
    return () => sub.remove();
  }, [refreshPush]);

  React.useEffect(() => {
    import('../../../lib/supabase').then(async ({ supabase }) => {
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('profiles')
        .select('notification_prefs')
        .eq('id', auth.user.id)
        .maybeSingle();
      if (data?.notification_prefs) {
        setPrefs((p) => ({ ...p, ...(data.notification_prefs as Record<string, boolean>) }));
      }
    });
  }, []);

  const toggle = async (key: string, value: boolean) => {
    setError(null);
    const next = { ...prefs, [key]: value };
    setPrefs(next); // optimistic
    const { supabase } = await import('../../../lib/supabase');
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error: err } = await supabase
      .from('profiles')
      .update({ notification_prefs: next, updated_at: new Date().toISOString() })
      .eq('id', auth.user.id);
    if (err) {
      setPrefs(prefs); // revert
      setError("Couldn't save that — check your connection and try again.");
    }
  };

  // Master toggle. ON: fires the OS dialog when never asked, otherwise just
  // (re-)registers the token. OFF: unregisters the token server-side — the
  // app can't revoke its own OS permission, so "off" means the dispatcher
  // has nowhere to deliver. In-app + email are unaffected either way.
  const togglePush = async (value: boolean) => {
    if (busy) return;
    setBusy(true);
    if (value) {
      await enablePush();
    } else {
      await disablePush();
    }
    setBusy(false);
    refreshPush();
  };

  const pushOn = push?.status === 'granted' && push.delivering === true;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Notification settings" />
      <ScrollView contentContainerStyle={styles.body}>
        {push?.available && (
          <Card style={{ padding: 16, marginBottom: 14 }}>
            {push.status === 'denied' && !push.canAskAgain ? (
              <>
                <View style={styles.pushRow}>
                  <View style={[styles.dot, { backgroundColor: '#B4442E' }]} />
                  <Text style={styles.pushTitle}>Push notifications are off</Text>
                </View>
                <Text style={styles.pushSub}>
                  You previously declined notifications, so your phone won't show the permission
                  dialog again. To turn them on, enable notifications for Snapt in your device
                  settings — we'll pick it up automatically when you come back.
                </Text>
                <Pressable onPress={() => Linking.openSettings()} style={styles.pushBtn}>
                  <Text style={styles.pushBtnLabel}>Open device settings</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.pushRow}>
                  <View style={[styles.dot, { backgroundColor: pushOn ? '#2E7D43' : colors.greyLight }]} />
                  <Text style={[styles.pushTitle, { flex: 1 }]}>Push notifications</Text>
                  <Switch
                    value={pushOn}
                    disabled={busy}
                    onValueChange={togglePush}
                    trackColor={{ true: colors.yellow }}
                    thumbColor="#fff"
                  />
                </View>
                <Text style={styles.pushSub}>
                  {pushOn
                    ? "You'll get booking offers, confirmations, and delivery alerts on this device — even when the app is closed."
                    : 'Turn on to get booking offers, confirmations, and delivery alerts on this device — even when the app is closed.'}
                </Text>
              </>
            )}
          </Card>
        )}

        <Card style={{ paddingVertical: 4, paddingHorizontal: 0 }}>
          {TOGGLES.map((t, i) => (
            <View key={t.key} style={[styles.row, i < TOGGLES.length - 1 && styles.rowBorder]}>
              <Text style={styles.rowLabel}>{t.label}</Text>
              <Switch
                value={prefs[t.key]}
                onValueChange={(v) => toggle(t.key, v)}
                trackColor={{ true: colors.yellow }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </Card>
        {error ? <Text style={styles.error}>{error}</Text> : null}
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
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pushTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  pushSub: { fontSize: 12.5, color: colors.grey, lineHeight: 18, marginTop: 8 },
  pushBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  pushBtnLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
  error: { fontSize: 12.5, fontWeight: '600', color: '#B4442E', marginTop: 10 },
});
