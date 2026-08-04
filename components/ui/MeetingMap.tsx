import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Text } from '../../lib/text';
import { colors } from '../../lib/theme';
import { MAP_PROVIDER } from '../../lib/mapProvider';

/**
 * Read-only meeting-point map (creator job detail, Session Day). Renders a
 * real Google map when the booking has pin coordinates; otherwise a labeled
 * placeholder — never a blank map. Static (no gestures): it's an
 * orientation glance, and the native Maps SDK render costs nothing.
 */
export function MeetingMap({
  lat,
  lng,
  label,
  height = 210,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string;
  height?: number;
}) {
  if (lat == null || lng == null) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>{label ?? 'Meeting point not set'}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.016 }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsPointsOfInterests={false}
      >
        <Marker coordinate={{ latitude: lat, longitude: lng }} pinColor="#FFB800" />
      </MapView>
      {label ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeLabel}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#E5E2DB' },
  placeholder: {
    borderRadius: 16,
    backgroundColor: '#E5E2DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { fontSize: 12, fontWeight: '600', color: colors.greyWarm },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  badgeLabel: { fontSize: 10.5, fontWeight: '700', color: colors.ink },
});
