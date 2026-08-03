import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';

// CD-design month calendar with availability dots: green = creators
// available, beige = fully booked, none = outside the bookable window.
// Only green days are selectable; the selected day is the yellow square.

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function MonthCalendar({
  flags,
  selected,
  onSelect,
}: {
  /** iso date -> creators available (undefined = outside window). */
  flags: Record<string, boolean | undefined>;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const [month, setMonth] = React.useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const weeks = React.useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [month]);

  const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const move = (dir: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + dir, 1));

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable onPress={() => move(-1)} style={styles.navBtn}>
          <Svg width={9} height={15} viewBox="0 0 10 17" fill="none">
            <Path d="M8.5 1.5L2 8.5l6.5 7" stroke={colors.greyLight} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={() => move(1)} style={styles.navBtn}>
          <Svg width={9} height={15} viewBox="0 0 10 17" fill="none">
            <Path d="M1.5 1.5L8 8.5l-6.5 7" stroke={colors.greyLight} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>
      <View style={styles.dowRow}>
        {DOW.map((d, i) => (
          <Text key={i} style={styles.dow}>
            {d}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((day, di) => {
            if (!day) return <View key={di} style={styles.cell} />;
            const iso = isoOf(day);
            const avail = flags[iso];
            const isSelected = selected === iso;
            const selectable = avail === true;
            return (
              <Pressable
                key={di}
                disabled={!selectable}
                onPress={() => onSelect(iso)}
                style={styles.cell}
              >
                <View style={[styles.dayWrap, isSelected && styles.daySelected]}>
                  <Text
                    style={[
                      styles.dayNum,
                      avail === undefined && styles.dayMuted,
                      isSelected && styles.dayNumSelected,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.dot,
                    avail === true && { backgroundColor: '#1B9A57' },
                    avail === false && { backgroundColor: '#D8D2C4' },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#1B9A57' }]} />
          <Text style={styles.legendLabel}>Creators available</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#D8D2C4' }]} />
          <Text style={styles.legendLabel}>Fully booked</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  dowRow: { flexDirection: 'row', marginBottom: 2 },
  dow: { flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '700', color: colors.greyLight },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: colors.yellow },
  dayNum: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  dayNumSelected: { fontWeight: '800' },
  dayMuted: { color: '#C6C3BC', fontWeight: '600' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
  legend: { flexDirection: 'row', gap: 16, marginTop: 10, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 10.5, fontWeight: '600', color: colors.grey },
});
