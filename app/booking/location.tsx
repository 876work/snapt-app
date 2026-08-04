import React from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../lib/text';
import { useRouter } from 'expo-router';
import MapView, { Marker, Polygon, Region } from 'react-native-maps';
import Svg, { Circle as SvgCircle, Path } from 'react-native-svg';
import { MAP_PROVIDER } from '../../lib/mapProvider';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { InfoBanner } from '../../components/ui/Misc';
import {
  LocationPrimeSheet,
  locationPermissionState,
  wasLocationPrimed,
} from '../../components/LocationPrime';
import { useBookings } from '../../lib/store';
import {
  DEFAULT_REGION,
  GeoArea,
  HIGHLIGHT_HIDE_DELTA,
  MAP_BOUNDS,
  MIN_ZOOM_LEVEL,
  MOCK_AREAS,
  MOCK_POLYGON,
  insideServiceArea,
  nearestArea,
} from '../../lib/geo';
import { colors, spacing, insetBottom } from '../../lib/theme';

// Meeting point. ONE polygon (the island's northern region) is the
// authoritative inside/outside check — the 19 highlighted locations are
// orientation markers and snap labels only. The server re-validates the pin
// against the same polygon at booking creation.

const LOGO = require('../../assets/design/snapt-icon.png');


export default function Location() {
  const router = useRouter();
  const { draft, setDraft } = useBookings();

  const [areas, setAreas] = React.useState<GeoArea[]>(MOCK_AREAS);
  const [polygon, setPolygon] = React.useState<[number, number][]>(MOCK_POLYGON);
  React.useEffect(() => {
    import('../../lib/api').then(({ apiConfigured, fetchServiceAreas }) => {
      if (!apiConfigured) return;
      fetchServiceAreas().then((result) => {
        if (result?.areas?.length) setAreas(result.areas);
        if (result?.polygon && result.polygon.length >= 3) setPolygon(result.polygon);
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
    () => (pin ? insideServiceArea(polygon, pin.latitude, pin.longitude) : false),
    [polygon, pin],
  );

  const place = React.useCallback(
    (latitude: number, longitude: number) => {
      setPin({ latitude, longitude });
      const ok = insideServiceArea(polygon, latitude, longitude);
      const near = nearestArea(areas, latitude, longitude);
      setDraft({
        meetingLat: latitude,
        meetingLng: longitude,
        area: ok && near ? near.area.name : null,
      });
    },
    [areas, polygon, setDraft],
  );

  // Highlight markers hide while zoomed in past the threshold or while the
  // user is dragging their pin — the user's own pin always dominates.
  const [zoomDelta, setZoomDelta] = React.useState(DEFAULT_REGION.latitudeDelta);
  const [dragging, setDragging] = React.useState(false);
  const showHighlights = zoomDelta >= HIGHLIGHT_HIDE_DELTA && !dragging;

  const mapRef = React.useRef<MapView>(null);
  const initialRegion: Region = pin
    ? { ...DEFAULT_REGION, latitude: pin.latitude, longitude: pin.longitude }
    : DEFAULT_REGION;

  // --- Location permission: priming BEFORE the one-shot OS prompt ---------
  const [primeVisible, setPrimeVisible] = React.useState(false);
  const [settingsNudge, setSettingsNudge] = React.useState(false);
  const [locBusy, setLocBusy] = React.useState(false);

  React.useEffect(() => {
    // First in-person booking = the moment location genuinely helps, so the
    // priming fires here (not at registration — see push-prime for the
    // notifications prompt; they can never appear back to back this way).
    (async () => {
      try {
        if (await wasLocationPrimed()) return;
        if ((await locationPermissionState()) === 'undetermined') setPrimeVisible(true);
      } catch {
        // expo-location missing from this binary (pre-rebuild) — skip.
      }
    })();
  }, []);

  const centerOnDevice = async () => {
    setLocBusy(true);
    try {
      const Location = await import('expo-location');
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = pos.coords;
      if (insideServiceArea(polygon, latitude, longitude)) {
        place(latitude, longitude);
        mapRef.current?.animateToRegion(
          { latitude, longitude, latitudeDelta: 0.02, longitudeDelta: 0.016 },
          400,
        );
      } else {
        // They're outside the region — keep the map on the service area and
        // let them pick manually; placing an invalid pin helps no one.
        mapRef.current?.animateToRegion(DEFAULT_REGION, 400);
      }
    } catch {
      // position unavailable — manual placement still works
    } finally {
      setLocBusy(false);
    }
  };

  const useMyLocation = async () => {
    if (locBusy) return;
    setSettingsNudge(false);
    try {
      const state = await locationPermissionState();
      if (state === 'granted') return centerOnDevice();
      if (state === 'undetermined') return setPrimeVisible(true);
      setSettingsNudge(true); // denied forever → soft Settings pointer
    } catch {
      // expo-location not in this binary — button is a no-op pre-rebuild
    }
  };

  const canContinue = pin != null && inside && draft.area != null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Where should we meet you?" />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Drop the pin where you want to meet — tap the map or drag the marker. We serve the
          island's northern region, shown in yellow.
        </Text>

        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            provider={MAP_PROVIDER}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            minZoomLevel={MIN_ZOOM_LEVEL}
            onMapReady={() => {
              // Pan constrained to the region. Enforcement differs by
              // platform: Android blocks the gesture at the edge; iOS
              // (Google SDK) allows a rubber-band past it, then settles
              // back inside.
              mapRef.current?.setMapBoundaries(MAP_BOUNDS.northEast, MAP_BOUNDS.southWest);
            }}
            onRegionChangeComplete={(region) => setZoomDelta(region.latitudeDelta)}
            onPress={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              place(latitude, longitude);
            }}
            toolbarEnabled={false}
            showsPointsOfInterests={false}
          >
            {/* THE service area — one northern-region polygon (authoritative) */}
            <Polygon
              coordinates={polygon.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
              strokeColor="rgba(185,134,0,0.75)"
              strokeWidth={2}
              fillColor="rgba(255,184,0,0.14)"
            />

            {/* 19 highlighted locations — orientation only, logo at 50% */}
            {showHighlights &&
              areas.map((a) => (
                <Marker
                  key={a.name}
                  coordinate={{ latitude: a.lat, longitude: a.lng }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                  zIndex={1}
                  title={a.name}
                >
                  <Image source={LOGO} style={styles.highlightLogo} />
                </Marker>
              ))}

            {/* The user's pin — always dominant */}
            {pin && (
              <Marker
                coordinate={pin}
                draggable
                zIndex={10}
                onDragStart={() => setDragging(true)}
                onDragEnd={(e) => {
                  setDragging(false);
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  place(latitude, longitude);
                }}
                pinColor={inside ? '#FFB800' : '#D64535'}
              />
            )}
          </MapView>

          <Pressable onPress={useMyLocation} style={styles.locateBtn}>
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
              <SvgCircle cx="12" cy="12" r="3" fill={colors.ink} />
              <SvgCircle cx="12" cy="12" r="7.5" stroke={colors.ink} strokeWidth={1.8} />
              <Path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
            <Text style={styles.locateLabel}>{locBusy ? 'Locating…' : 'Use my location'}</Text>
          </Pressable>
        </View>

        {settingsNudge && (
          <View style={styles.settingsCard}>
            <Text style={styles.settingsText}>
              Location is off for Snapt in your phone's settings. No pressure — the map works
              fine by hand. If you'd like us to find you automatically:
            </Text>
            <Pressable onPress={() => Linking.openSettings()}>
              <Text style={styles.settingsLink}>Open Settings</Text>
            </Pressable>
          </View>
        )}

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
              Meeting near <Text style={{ color: colors.yellowDark }}>{snapped.area.name}</Text>
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
              Tap anywhere inside the yellow zone to place your pin, or jump to a spot below.
            </Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Jump to a spot</Text>
        <View style={styles.areaWrap}>
          {areas.map((a) => {
            const active = draft.area === a.name;
            return (
              <Pressable
                key={a.name}
                onPress={() => {
                  place(a.lat, a.lng);
                  mapRef.current?.animateToRegion(
                    { latitude: a.lat, longitude: a.lng, latitudeDelta: 0.03, longitudeDelta: 0.024 },
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

      <View style={styles.footer}>
        <Button
          title="Continue"
          arrow
          disabled={!canContinue}
          onPress={() => router.push('/booking/creator')}
          style={{ flex: 1 }}
        />
      </View>

      <LocationPrimeSheet
        visible={primeVisible}
        onDone={(granted) => {
          setPrimeVisible(false);
          if (granted) centerOnDevice();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.offWhite },
  body: { paddingHorizontal: spacing.screenX, paddingTop: 8 },
  lead: { fontSize: 13, color: colors.grey, lineHeight: 19, marginBottom: 12 },
  mapWrap: {
    height: 300,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#E5E2DB',
  },
  highlightLogo: { width: 30, height: 30, opacity: 0.5 },
  locateBtn: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 11,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  locateLabel: { fontSize: 11.5, fontWeight: '800', color: colors.ink },
  settingsCard: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EFEDE7',
    borderRadius: 12,
    padding: 12,
  },
  settingsText: { fontSize: 12, color: colors.grey, lineHeight: 17.5 },
  settingsLink: { fontSize: 12.5, fontWeight: '800', color: colors.yellowDark, marginTop: 8 },
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
