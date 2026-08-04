import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Svg, { Circle as SvgCircle, Path } from 'react-native-svg';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { InfoBanner } from '../../components/ui/Misc';
import { Area } from '../../lib/mock/data';
import { useBookings } from '../../lib/store';
import { DEFAULT_REGION, GeoArea, MOCK_AREAS, insideServiceArea, nearestArea } from '../../lib/geo';
import { colors, spacing, insetBottom } from '../../lib/theme';

// Meeting point: real Google map with a draggable pin. The pin snaps its
// label to the nearest named service area (pure math on coordinates fetched
// once from /v1/service-areas — no per-interaction Google requests) and is
// validated against the coverage circles; the server re-validates at booking
// creation. The optional directions text rides along as meeting_point and
// surfaces on the creator's job detail.

export default function Location() {
  const router = useRouter();
  const { draft, setDraft } = useBookings();

  const [areas, setAreas] = React.useState<GeoArea[]>(MOCK_AREAS);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchServiceAreas }) => {
      if (!apiConfigured) return;
      fetchServiceAreas().then((real) => {
        if (real && real.length > 0) setAreas(real);
      });
    });
  }, []);

  const [pin, setPin] = React.useState<{ latitude: number; longitude: number } | null>(
    draft.meetingLat != null && draft.meetingLng != null
      ? { latitude: draft.meetingLat, longitude: draft.meetingLng }
      : null,
  );

  const snapped = React.useMemo(
    () => (pin ? nearestArea(areas, pin.latitude, pin.longitude) : null),
    [areas, pin],
  );
  const inside = React.useMemo(
    () => (pin ? insideServiceArea(areas, pin.latitude, pin.longitude) : false),
    [areas, pin],
  );

  const place = (latitude: number, longitude: number) => {
    setPin({ latitude, longitude });
    const near = nearestArea(areas, latitude, longitude);
    const ok = insideServiceArea(areas, latitude, longitude);
    setDraft({
      meetingLat: latitude,
      meetingLng: longitude,
      area: ok && near ? (near.area.name as Area) : null,
    });
  };

  const pickArea = (a: GeoArea) => {
    place(a.lat, a.lng);
  };

  const mapRef = React.useRef<MapView>(null);
  const initialRegion: Region = pin
    ? { ...DEFAULT_REGION, latitude: pin.latitude, longitude: pin.longitude }
    : DEFAULT_REGION;

  const canContinue = pin != null && inside && draft.area != null;

  return (
    <View style={styles.root}>
      {/* Fixed header (never scrolls, always clear of the status bar) */}
      <ScreenHeader title="Where should we meet you?" />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Drop the pin where you want to meet — tap the map or drag the marker. We'll match it to
          the nearest service area.
        </Text>

        {/* Real map — coverage circles + draggable pin */}
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            onPress={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              place(latitude, longitude);
            }}
            toolbarEnabled={false}
            showsPointsOfInterests={false}
          >
            {areas.map((a) => (
              <Circle
                key={a.name}
                center={{ latitude: a.lat, longitude: a.lng }}
                radius={a.radius_km * 1000}
                strokeColor="rgba(185,134,0,0.55)"
                strokeWidth={1}
                fillColor="rgba(255,184,0,0.14)"
              />
            ))}
            {pin && (
              <Marker
                coordinate={pin}
                draggable
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  place(latitude, longitude);
                }}
                pinColor={inside ? '#FFB800' : '#D64535'}
              />
            )}
          </MapView>
          <View style={styles.mapLegend} pointerEvents="none">
            <View style={styles.legendRow}>
              <View style={styles.legendSwatchIn} />
              <Text style={styles.legendLabel}>Service area</Text>
            </View>
          </View>
        </View>

        {/* Snapped label / validation state */}
        {pin && inside && snapped && (
          <View style={styles.snapRow}>
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"
                stroke={colors.yellowDark}
                strokeWidth={1.8}
                strokeLinejoin="round"
              />
              <SvgCircle cx="12" cy="10" r="2.3" stroke={colors.yellowDark} strokeWidth={1.8} />
            </Svg>
            <Text style={styles.snapLabel}>
              Meeting in <Text style={{ color: colors.yellowDark }}>{snapped.area.name}</Text>
              {snapped.distanceKm > 0.3 ? ` · ${snapped.distanceKm.toFixed(1)} km from center` : ''}
            </Text>
          </View>
        )}
        {pin && !inside && (
          <View style={{ marginTop: 12 }}>
            <InfoBanner
              tone="error"
              text="This location is outside our current service area. Please choose a location within the highlighted zone."
            />
          </View>
        )}
        {!pin && (
          <View style={styles.svcRow}>
            <Text style={styles.svcText}>
              We currently serve the highlighted areas. Tap the map or pick an area below to place
              your pin.
            </Text>
          </View>
        )}

        {/* Quick-pick chips re-center the pin on an area */}
        <Text style={styles.sectionLabel}>Or pick a service area</Text>
        <View style={styles.areaWrap}>
          {areas.map((a) => {
            const active = draft.area === a.name;
            return (
              <Pressable
                key={a.name}
                onPress={() => {
                  pickArea(a);
                  mapRef.current?.animateToRegion(
                    { latitude: a.lat, longitude: a.lng, latitudeDelta: 0.06, longitudeDelta: 0.05 },
                    350,
                  );
                }}
                style={[styles.areaChip, active && styles.areaChipActive]}
              >
                <Text style={[styles.areaChipLabel, active && { color: colors.ink }]}>{a.name}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Optional directions — carries to the creator's job detail */}
        <Text style={styles.sectionLabel}>Directions for your creator (optional)</Text>
        <TextInput
          value={draft.meetingPoint}
          onChangeText={(t) => setDraft({ meetingPoint: t })}
          placeholder="e.g. Blue gate opposite the fish market"
          placeholderTextColor="#9A9A9A"
          style={styles.directionsInput}
          multiline
        />
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Pinned footer — Continue never requires scrolling */}
      <View style={styles.footer}>
        <Button
          title="Continue"
          arrow
          disabled={!canContinue}
          onPress={() => router.push('/booking/creator')}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  lead: { fontSize: 13, color: colors.grey, lineHeight: 19, marginBottom: 12 },
  mapWrap: {
    height: 260,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#E5E2DB',
  },
  mapLegend: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatchIn: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: 'rgba(255,184,0,0.4)',
    borderWidth: 1.5,
    borderColor: colors.yellowDark,
  },
  legendLabel: { fontSize: 10.5, fontWeight: '600', color: colors.ink },
  snapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 12,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: colors.yellowSoftBorder,
    borderRadius: 12,
    padding: 12,
  },
  snapLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  svcRow: {
    marginTop: 12,
    backgroundColor: colors.yellowSoft,
    borderWidth: 1,
    borderColor: '#F4E7C0',
    borderRadius: 12,
    padding: 12,
  },
  svcText: { fontSize: 12, color: colors.goldText, lineHeight: 17.5, fontWeight: '500' },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: colors.ink,
    marginTop: 22,
    marginBottom: 12,
  },
  areaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  areaChip: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderWarm,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  areaChipActive: { borderColor: colors.yellow, backgroundColor: colors.yellowSoft },
  areaChipLabel: { fontSize: 12.5, fontWeight: '700', color: colors.grey },
  directionsInput: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Math.max(insetBottom + 12, 30),
    backgroundColor: colors.offWhite,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexDirection: 'row',
  },
});
