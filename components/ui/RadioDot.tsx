import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../lib/theme';

/**
 * The selected-state control for every PICK-ONE list in the app.
 *
 * Round, deliberately: a square control reads as a checkbox, which implies
 * "tick as many as you like". Every list using this is single-choice, so
 * the shape has to say so. Five screens had grown four slightly different
 * versions of this — three ring-style circles, one filled circle, and one
 * that morphed into a rounded SQUARE when selected (the Duration screen).
 *
 * Selected is a thick yellow ring rather than a fill, which reads at a
 * glance against the yellow-tinted row background those lists use when
 * active.
 */
export function RadioDot({ selected }: { selected: boolean }) {
  return <View style={[styles.dot, selected && styles.dotOn]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.greyLight,
    backgroundColor: '#fff',
  },
  dotOn: { borderWidth: 6, borderColor: colors.yellow },
});
