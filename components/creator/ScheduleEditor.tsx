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

/** Matches the server's default for a new creator (routes/creators.ts). */
const DEFAULT_START = '06:00';
const DEFAULT_END = '22:00';

/** True when every one of the seven days is on with the same window. */
function allSevenIdentical(w: Windows): boolean {
  const first = w[DAYS[0].key]?.[0];
  if (!first) return false;
  return DAYS.every((d) => {
    const day = w[d.key];
    return day?.length === 1 && day[0].start === first.start && day[0].end === first.end;
  });
}

export function ScheduleEditor() {
  const [loadedFor, setLoadedFor] = React.useState<'none' | 'mock' | 'api'>('none');
  const [hours, setHours] = React.useState<Windows>({});
  const [blocked, setBlocked] = React.useState<string[]>([]);
  const [radius, setRadius] = React.useState<string>('');
  const [showRadius, setShowRadius] = React.useState(false);
  const [sameEveryDay, setSameEveryDay] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchCreatorMe }) => {
      if (!apiConfigured) {
        setHours({ mon: [{ start: DEFAULT_START, end: DEFAULT_END }], sat: [{ start: DEFAULT_START, end: DEFAULT_END }] });
        setLoadedFor('mock');
        return;
      }
      fetchCreatorMe().then((me) => {
        if (me) {
          const loaded = (me.availability ?? {}) as Windows;
          setHours(loaded);
          // Start in "same every day" mode when the saved hours already are
          // identical across all seven — which is what the new default gives
          // every creator, so most people open this screen to one row.
          setSameEveryDay(allSevenIdentical(loaded));
          setBlocked(me.blocked_dates ?? []);
          setRadius(me.service_radius_km != null ? String(me.service_radius_km) : '');
          setShowRadius(me.service_type !== 'remote');
        }
        setLoadedFor('api');
      });
    });
  }, []);

  const dayOn = (key: string) => (hours[key]?.length ?? 0) > 0;
  const window = (key: string) => hours[key]?.[0] ?? { start: DEFAULT_START, end: DEFAULT_END };

  const toggleDay = (key: string) => {
    setHours((h) => ({ ...h, [key]: dayOn(key) ? [] : [{ start: DEFAULT_START, end: DEFAULT_END }] }));
    setDirty(true);
  };
  const setTime = (key: string, field: 'start' | 'end', value: string) => {
    setHours((h) => ({ ...h, [key]: [{ ...window(key), [field]: value }] }));
    setDirty(true);
  };

  /**
   * SAME EVERY DAY. Most creators work one window all week and had to type
   * it into seven rows by hand, which is both tedious and the kind of thing
   * people abandon halfway — leaving a half-set week that quietly costs them
   * bookings. On, this collapses to a single editor writing all seven days.
   */
  const uniformWindow = () => {
    const firstOn = DAYS.map((d) => d.key).find((k) => dayOn(k));
    return firstOn ? window(firstOn) : { start: DEFAULT_START, end: DEFAULT_END };
  };
  const applyToAllDays = (w: { start: string; end: string }) => {
    setHours(Object.fromEntries(DAYS.map((d) => [d.key, [{ ...w }]])));
    setDirty(true);
  };
  const toggleSameEveryDay = (on: boolean) => {
    setSameEveryDay(on);
    if (on) applyToAllDays(uniformWindow());
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
        <View style={[styles.dayRow, styles.dayRowBorder]}>
          <Text style={styles.sameLabel}>Same every day</Text>
          <Switch
            value={sameEveryDay}
            onValueChange={toggleSameEveryDay}
            trackColor={{ true: colors.yellow }}
            thumbColor="#fff"
          />
        </View>
        {sameEveryDay ? (
          <View style={styles.dayRow}>
            <Text style={styles.dayLabel}>All</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              <TextInput
                value={uniformWindow().start}
                onChangeText={(v) => applyToAllDays({ ...uniformWindow(), start: v })}
                style={styles.timeInput}
                placeholder={DEFAULT_START}
                placeholderTextColor="#B4B1AA"
              />
              <Text style={styles.timeDash}>–</Text>
              <TextInput
                value={uniformWindow().end}
                onChangeText={(v) => applyToAllDays({ ...uniformWindow(), end: v })}
                style={styles.timeInput}
                placeholder={DEFAULT_END}
                placeholderTextColor="#B4B1AA"
              />
            </View>
          </View>
        ) : DAYS.map((d, i) => (
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
      {/* The explainer belongs HERE, beside the calendar it describes. It
          used to float after the jobs list, explaining a control that was
          two screens further down. */}
      <Text style={styles.blockNote}>
        Need time off? Blocked dates sync automatically — clients can't book you on days you mark
        unavailable.
      </Text>
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
  sameLabel: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.ink },
  blockNote: { fontSize: 11.5, color: '#9A948B', lineHeight: 17, marginTop: -2, marginBottom: 10 },
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
