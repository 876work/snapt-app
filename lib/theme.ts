export const colors = {
  yellow: '#FFB800',
  yellowDark: '#B98600',
  yellowSoft: '#FFF9EC',
  yellowSoftBorder: '#F2E3B8',
  yellowTint: '#FFF4D6',
  offWhite: '#FAFAFA',
  ink: '#1A1A1A',
  grey: '#767676',
  greyWarm: '#8A8377',
  greyLight: '#B4B1AA',
  greyFaint: '#A8A29A',
  success: '#2ECC71',
  error: '#EB5757',
  errorDark: '#C0392B',
  errorSoft: '#FFF1F0',
  errorSoftBorder: '#F6D5D2',
  card: '#FFFFFF',
  border: '#ECECEC',
  borderWarm: '#EDEAE3',
  segBg: '#EFEDE7',
  segBgAlt: '#F4F1EA',
  divider: '#ECEAE4',
  canvas: '#EDEBE6',
  goldText: '#8A7530',
} as const;

export const radii = {
  card: 16,
  sheet: 24,
  pill: 999,
  input: 14,
  chip: 13,
  sm: 12,
} as const;

import { initialWindowMetrics } from 'react-native-safe-area-context';

// Device safe-area insets, readable at module load so StyleSheets can use
// them directly. The design frame assumed a 47pt notch and a 34pt home
// indicator; screens offset from these instead of hardcoding those guesses.
// Fallbacks reproduce the old fixed values if metrics are unavailable.
export const insetTop = initialWindowMetrics?.insets.top ?? 47;
export const insetBottom = initialWindowMetrics?.insets.bottom ?? 0;

export const spacing = {
  screenX: 22,
  headerTop: insetTop + 11,
} as const;

/**
 * THE FLOATING NAV PILL, as geometry rather than a guess.
 *
 * The pill is absolutely positioned, so it takes no layout space and sits ON
 * TOP of whatever a screen renders underneath. Every tab root therefore has to
 * reserve room for it, or its last section is unreachable no matter how far
 * you scroll — "How it works" on Home was permanently behind it.
 *
 * These are the SAME numbers the bar itself is built from (app/(app)/_layout
 * imports them), so the clearance cannot drift away from the thing it is
 * clearing. `insetBottom` covers the iOS home indicator AND the Android
 * system nav bar, both of which sit under the pill.
 */
export const navPill = {
  /** 42pt item + 7pt padding top and bottom. */
  height: 56,
  /** Gap from the bottom of the screen, floored for devices with no inset. */
  bottom: Math.max(insetBottom + 8, 26),
} as const;

/** Bottom padding a scrollable tab root needs so nothing hides behind the pill. */
export const navPillClearance = navPill.height + navPill.bottom + 12;

export const type = {
  title: { fontSize: 19, fontWeight: '800' as const, letterSpacing: -0.3, color: colors.ink },
  section: { fontSize: 15, fontWeight: '800' as const, letterSpacing: -0.2, color: colors.ink },
  body: { fontSize: 13.5, color: colors.grey, lineHeight: 19.5 },
  caption: { fontSize: 12, color: colors.grey },
  overline: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    color: colors.greyLight,
  },
} as const;
