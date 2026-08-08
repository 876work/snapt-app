import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardScrollView } from '../../components/ui/KeyboardScrollView';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SlideToConfirm } from '../../components/ui/SlideToConfirm';
import { useAuth } from '../../lib/store';
import { formatMoney } from '../../lib/constants/business';
import { colors, insetBottom } from '../../lib/theme';

// The six real payout methods (Don, 2026-07-28). Field sets mirror the
// server: cash needs none (pickup mechanics = pending product decision);
// penny_pinch field pending confirmation of what the wallet requires.
const METHODS: { id: string; name: string; eta: string; fields: { key: string; label: string }[] }[] = [
  { id: 'cash', name: 'Cash pickup', eta: 'Same day', fields: [] },
  { id: 'penny_pinch', name: 'Penny Pinch', eta: 'Instant', fields: [{ key: 'email', label: 'Penny Pinch email' }] },
  { id: 'cibc', name: 'CIBC', eta: '1–2 business days', fields: [{ key: 'holder_name', label: 'Account holder name' }, { key: 'account_number', label: 'Account number' }] },
  { id: 'republic_ec', name: 'Republic Bank (EC)', eta: '1–2 business days', fields: [{ key: 'holder_name', label: 'Account holder name' }, { key: 'account_number', label: 'Account number' }] },
  { id: 'bank_slu', name: 'Bank of Saint Lucia', eta: '1–2 business days', fields: [{ key: 'holder_name', label: 'Account holder name' }, { key: 'account_number', label: 'Account number' }] },
  { id: 'paypal', name: 'PayPal', eta: 'Within 24 hours', fields: [{ key: 'email', label: 'PayPal email' }] },
];

function methodSub(id: string, saved?: Record<string, string>): string {
  if (id === 'cash') return 'Pick up at a Snapt partner location';
  if (!saved) return 'Details needed';
  if (id === 'paypal' || id === 'penny_pinch') return saved.email ?? 'Linked';
  return `${saved.holder_name ?? ''} ····${(saved.account_number ?? '').slice(-4)}`;
}

export default function CashOut() {
  const router = useRouter();
  const currency = useAuth((s) => s.currency);
  const [method, setMethod] = React.useState('cibc');
  // Saved per-method details (API mode). Selecting an unconfigured method
  // opens its small form; saving syncs to the server, which requires
  // details on file before cash-out.
  const [saved, setSaved] = React.useState<Record<string, Record<string, string>>>({});
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [methodError, setMethodError] = React.useState<string | null>(null);
  // Admin toggle: disabled methods can't be newly selected. A creator whose
  // CURRENT method was disabled still sees it (server reports it enabled
  // for them) — existing setups are honored, only new selections blocked.
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchPayoutMethods }) => {
      if (!apiConfigured) return;
      fetchPayoutMethods().then((pm) => {
        if (!pm) return;
        setSaved(pm.methods ?? {});
        setEnabled(pm.enabled ?? {});
        if (pm.selected) setMethod(pm.selected);
      });
    });
  }, []);
  const selectedDef = METHODS.find((m) => m.id === method)!;
  const configured = (id: string) => id === 'cash' || Boolean(saved[id]);
  const saveDetails = async () => {
    setMethodError(null);
    const api = await import('../../lib/api');
    if (api.apiConfigured) {
      const r = await api.savePayoutMethod(method, form);
      if (r && 'error' in r) {
        setMethodError(r.error ?? 'Could not save');
        return;
      }
    }
    setSaved((prev) => ({ ...prev, [method]: { ...form } }));
    setForm({});
  };
  const [done, setDone] = React.useState(false);
  // Real available balance in API mode; mock figure otherwise. Payout
  // methods stay illustrative until Stripe Connect onboarding (Phase 7).
  const [available, setAvailable] = React.useState(128);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchEarnings }) => {
      if (!apiConfigured) return;
      fetchEarnings().then((data) => {
        if (data) setAvailable(data.totals.available);
      });
    });
  }, []);
  const confirmCashOut = async () => {
    setMethodError(null);
    if (!configured(method)) {
      setMethodError('Add your details for this method first.');
      return false; // slider unlocks so the user can retry
    }
    const { apiConfigured, cashOutApi } = await import('../../lib/api');
    if (apiConfigured) {
      const result = await cashOutApi();
      if (result && 'error' in result) {
        setMethodError(result.error);
        return false;
      }
    }
    setDone(true);
    return true;
  };

  if (done) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Cash out" />
        <View style={styles.doneWrap}>
          <View style={styles.doneIcon}>
            <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12.5l4.5 4.5L19 7" stroke={colors.ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <Text style={styles.doneTitle}>{formatMoney(available, currency)} requested</Text>
          <Text style={styles.doneSub}>
            Requested to {selectedDef.name}. Our team sends it manually — you'll get a notification
            the moment it's on its way.
          </Text>
          <Pressable onPress={() => router.back()} style={styles.doneBtn}>
            <Text style={styles.doneBtnLabel}>Back to Earnings</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Cash out" />
      <KeyboardScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>AVAILABLE TO CASH OUT</Text>
          <Text style={styles.amountValue}>{formatMoney(available, currency)}</Text>
          <Text style={styles.amountNote}>No cash-out fees. Pending funds aren't included.</Text>
        </View>

        <Text style={styles.sectionTitle}>Send to</Text>
        <View style={styles.list}>
          {METHODS.map((m, i) => {
            const active = m.id === method;
            const ok = configured(m.id);
            const off = enabled[m.id] === false;
            return (
              <View key={m.id} style={i < METHODS.length - 1 && styles.rowBorder}>
                <Pressable
                  onPress={() => {
                    if (off) {
                      setMethodError('That payout method is not currently available.');
                      return;
                    }
                    setMethod(m.id); setForm({}); setMethodError(null);
                  }}
                  style={[styles.methodRow, off && { opacity: 0.4 }]}
                >
                  <View style={[styles.radio, active && styles.radioActive]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.methodName}>{m.name}</Text>
                    <Text style={[styles.methodSub, !ok && !off && { color: '#B98600', fontWeight: '700' }]}>
                      {off ? 'Not currently available' : methodSub(m.id, saved[m.id])}
                    </Text>
                  </View>
                  <Text style={styles.methodEta}>{m.eta}</Text>
                </Pressable>
                {active && !ok && (
                  <View style={{ paddingHorizontal: 18, paddingBottom: 14, gap: 8 }}>
                    {m.fields.map((f) => (
                      <TextInput
                        key={f.key}
                        placeholder={f.label}
                        placeholderTextColor="#9A9A9A"
                        value={form[f.key] ?? ''}
                        onChangeText={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
                        autoCapitalize={f.key === 'email' ? 'none' : 'words'}
                        style={{ borderWidth: 1.5, borderColor: '#EFEBE3', borderRadius: 10, padding: 10, fontSize: 13 }}
                      />
                    ))}
                    {methodError ? <Text style={{ fontSize: 12, color: '#C0392B', fontWeight: '600' }}>{methodError}</Text> : null}
                    <Pressable
                      onPress={saveDetails}
                      style={{ height: 40, borderRadius: 10, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Save details</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </KeyboardScrollView>
      <View style={styles.footer}>
        {methodError && configured(method) ? <Text style={styles.footerError}>{methodError}</Text> : null}
        <SlideToConfirm
          label={`Slide to cash out ${formatMoney(available, currency)}`}
          disabled={available <= 0}
          onConfirm={confirmCashOut}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: 22, paddingTop: 8 },
  amountCard: { backgroundColor: colors.ink, borderRadius: 18, padding: 22, alignItems: 'center' },
  amountLabel: { fontSize: 9.5, fontWeight: '800', color: colors.yellow, letterSpacing: 0.6 },
  amountValue: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, color: '#fff', marginTop: 8 },
  amountNote: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 22, marginBottom: 12 },
  list: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 15, paddingHorizontal: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F4F1EA' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D8D2C4' },
  radioActive: { borderWidth: 6, borderColor: colors.yellow },
  methodName: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  methodSub: { fontSize: 11, color: colors.greyWarm, marginTop: 2 },
  methodEta: { fontSize: 10, color: '#9A948B', fontWeight: '600' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  footerError: { fontSize: 12.5, color: colors.error, fontWeight: '600', marginBottom: 10 },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, marginTop: -80 },
  doneIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  doneTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  doneSub: { fontSize: 13.5, color: colors.grey, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  doneBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 28,
  },
  doneBtnLabel: { fontSize: 15, fontWeight: '800', color: colors.ink },
});
