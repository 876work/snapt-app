import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from '../../lib/text';
import { MonthCalendar } from '../ui/MonthCalendar';
import { colors } from '../../lib/theme';

// Working hours + blocked dates + service radius editor. Loads from
// /v1/creator/me, saves via PUT /v1/creator/settings — these feed the real
// slot engine, so edits change what clients can book immediately.

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

type Windows = Record<string, { start: string; end: string }[]>;

export function ScheduleEditor() {
  const [loadedFor, setLoadedFor] = React.useState<'none' | 'mock' | 'api'>('none');
  const [hours, setHours] = React.useState<Windows>({});
  const [blocked, setBlocked] = React.useState<string[]>([]);
  const [radius, setRadius] = React.useState<string>('');
  const [showRadius, setShowRadius] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) {
        setHours({ mon: [{ start: '09:00', end: '17:00' }], sat: [{ start: '09:00', end: '17:00' }] });
        setLoadedFor('mock');
        return;
      }
      fetchCreatorMe().then((me) => {
        if (me) {
          setHours((me.availability ?? {}) as Windows);
          setBlocked(me.blocked_dates ?? []);
          setRadius(me.service_radius_km != null ? String(me.service_radius_km) : '');
          setShowRadius(me.service_type !== 'remote');
        }
        setLoadedFor('api');
      });
    });
  }, []);

  const dayOn = (key: string) => (hours[key]?.length ?? 0) > 0;
  const window = (key: string) => hours[key]?.[0] ?? { start: '09:00', end: '17:00' };

  const toggleDay = (key: string) => {
    setHours((h) => ({ ...h, [key]: dayOn(key) ? [] : [{ start: '09:00', end: '17:00' }] }));
    setDirty(true);
  };
  const setTime = (key: string, field: 'start' | 'end', value: string) => {
    setHours((h) => ({ ...h, [key]: [{ ...window(key), [field]: value }] }));
    setDirty(true);
  };
  const toggleBlocked = (iso: string) => {
    setBlocked((b) => (b.includes(iso) ? b.filter((d) => d !== iso) : [...b, iso]));
    setDirty(true);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const [day, windows] of Object.entries(hours)) {
      for (const w of windows) {
        if (!hhmm.test(w.start) || !hhmm.test(w.end) || w.start >= w.end) {
          setNote(`Check the hours on ${day.toUpperCase()} — use 24h HH:MM with start before end.`);
          setBusy(false);
          return;
        }
      }
    }
    const api = await import('../../lib/api');
    if (!api.apiConfigured) {
      setBusy(false);
      setDirty(false);
      setNote('Saved (demo).');
      return;
    }
    const radiusNum = radius.trim() === '' ? null : Number(radius);
    const result = await api.updateCreatorSettingsApi({
      availability: hours,
      blocked_dates: blocked,
      ...(showRadius ? { service_radius_km: Number.isFinite(radiusNum as number) ? radiusNum : null } : {}),
    });
    setBusy(false);
    if (!result || 'error' in result) {
      setNote(result && 'error' in result ? result.error : 'Could not save — try again.');
      return;
    }
    setDirty(false);
    setNote('Saved — clients now see your updated availability.');
  };

  // Calendar flags: next 60 days selectable; blocked days render as
  // "fully booked" (beige) so the legend reads naturally.
  const flags = React.useMemo(() => {
    const out: Record<string, boolean> = {};
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.now() + i * 86400_000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out[iso] = !blocked.includes(iso);
    }
    return out;
  }, [blocked]);

  if (loadedFor === 'none') return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>WORKING HOURS</Text>
      <View style={styles.card}>
        {DAYS.map((d, i) => (
          <View key={d.key} style={[styles.dayRow, i < DAYS.length - 1 && styles.dayRowBorder]}>
            <Text style={styles.dayLabel}>{d.label}</Text>
            {dayOn(d.key) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TextInput
                  value={window(d.key).start}
                  onChangeText={(v) => setTime(d.key, 'start', v)}
                  style={styles.timeInput}
                  placeholder="09:00"
                  placeholderTextColor="#B4B1AA"
                />
                <Text style={styles.timeDash}>–</Text>
                <TextInput
                  value={window(d.key).end}
                  onChangeText={(v) => setTime(d.key, 'end', v)}
                  style={styles.timeInput}
                  placeholder="17:00"
                  placeholderTextColor="#B4B1AA"
                />
              </View>
            ) : (
              <Text style={styles.offLabel}>Off</Text>
            )}
            <Switch
              value={dayOn(d.key)}
              onValueChange={() => toggleDay(d.key)}
              trackColor={{ true: colors.yellow }}
              thumbColor="#fff"
            />
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>BLOCKED DATES — TAP A DAY TO TOGGLE</Text>
      <MonthCalendar flags={flags} selected={null} onSelect={toggleBlocked} />

      {showRadius && (
        <>
          <Text style={styles.sectionLabel}>SERVICE RADIUS (KM)</Text>
          <TextInput
            value={radius}
            onChangeText={(v) => {
              setRadius(v.replace(/[^0-9]/g, ''));
              setDirty(true);
            }}
            keyboardType="number-pad"
            placeholder="e.g. 25"
            placeholderTextColor="#B4B1AA"
            style={styles.radiusInput}
          />
        </>
      )}

      {note ? <Text style={styles.note}>{note}</Text> : null}
      <Pressable onPress={save} disabled={!dirty || busy} style={[styles.saveBtn, (!dirty || busy) && { opacity: 0.5 }]}>
        <Text style={styles.saveLabel}>{busy ? 'Saving…' : 'Save availability'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.yellowDark,
    marginTop: 20,
    marginBottom: 9,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#EFEDE7',
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  dayRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEDE7' },
  dayLabel: { width: 38, fontSize: 13, fontWeight: '800', color: colors.ink },
  offLabel: { flex: 1, fontSize: 12.5, color: '#A8A29A', fontWeight: '600', textAlign: 'right', marginRight: 4 },
  timeInput: {
    width: 62,
    height: 36,
    borderWidth: 1,
    borderColor: '#E7E3DA',
    borderRadius: 9,
    textAlign: 'center',
    fontSize: 12.5,
    color: colors.ink,
    backgroundColor: '#FAF8F3',
    paddingVertical: 0,
  },
  timeDash: { color: '#A8A29A' },
  radiusInput: {
    height: 50,
    borderWidth: 1,
    borderColor: '#E7E3DA',
    borderRadius: 14,
    paddingHorizontal: 15,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  note: { fontSize: 12, fontWeight: '600', color: colors.grey, marginTop: 12 },
  saveBtn: {
    height: 50,
    borderRadius: 15,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  saveLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
});
