export const colors = {
  // Primary Design Tokens
  background: '#F3F3F1',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F7F5',
  hero: '#202022',
  primaryAction: '#202022',
  dock: '#202022',
  darkRaised: '#2D2D31',
  textPrimary: '#1C1C1E',
  textSecondary: '#606068',
  textMuted: '#6B6B73',
  textInverse: '#FFFFFF',
  textInverseSecondary: '#D0D0D5',
  border: '#E4E4E7',
  borderMuted: '#ECECEE',
  successText: '#166534',
  successSurface: '#EAF6EC',
  progressAccent: '#24A148',
  warningText: '#92400E',
  warningSurface: '#FFF4DE',
  danger: '#C62828',
  dangerSurface: '#FFF0F0',
  mapRoute: '#2563EB',

  // Backward-compatible semantic aliases
  text: '#1C1C1E',
  muted: '#6B6B73',
  textLight: '#94A3B8',
  primary: '#202022',
  primarySoft: '#F3F3F1',
  primaryDark: '#141416',
  success: '#166534',
  successSoft: '#EAF6EC',
  warning: '#92400E',
  warningSoft: '#FFF4DE',
  warningBorder: '#FDE68A',
  dangerSoft: '#FFF0F0',
  dangerDark: '#991B1B',

  // Logistics & Status
  logisticsBlue: '#2563EB',
  logisticsCyan: '#0284C7',
  logisticsCyanSoft: '#E0F2FE',

  // Call / Dark Screen
  callBg: '#1C1C1E',
  callBgDark: '#141416',
  callAvatarRing: '#24A148',
  callActionBg: '#2D2D31',

  // Legacy aliases
  headerNavy: '#202022',
  headerNavyDark: '#141416',
  voiceGreen: '#166534',
  voiceGreenSoft: '#EAF6EC',
  borderLight: '#ECECEE',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 9999,
  full: 9999,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const },
  pageTitle: { fontSize: 28, lineHeight: 36, fontWeight: '700' as const },
  sectionTitle: { fontSize: 22, lineHeight: 30, fontWeight: '600' as const },
  body: { fontSize: 18, lineHeight: 27, fontWeight: '400' as const },
  button: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
} as const;
