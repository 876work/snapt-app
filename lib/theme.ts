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

export const spacing = {
  screenX: 22,
  headerTop: 58,
} as const;

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
