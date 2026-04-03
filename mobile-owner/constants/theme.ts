// QR Vault — Design Tokens
// Mirrors the web CSS variables for consistent branding

export const Colors = {
  accent: '#f59e0b',
  accentHover: '#d97706',
  accentLight: 'rgba(245, 158, 11, 0.12)',
  accentGlow: 'rgba(245, 158, 11, 0.25)',

  bgObsidian: '#050505',
  bgSurface: '#0a0a0c',
  bgElevated: '#111113',

  glass: 'rgba(255, 255, 255, 0.04)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHover: 'rgba(255, 255, 255, 0.07)',

  textPrimary: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#64748b',
  textInverse: '#050505',

  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',

  unread: 'rgba(245, 158, 11, 0.15)',
  unreadBorder: 'rgba(245, 158, 11, 0.4)',
};

export const Radii = {
  xs: 6,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  full: 999,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Typography = {
  heading: 'Inter_700Bold',
  headingBold: 'Inter_700Bold',
  body: 'Inter_400Regular',
  bodySemiBold: 'Inter_600SemiBold',

  sizeXs: 11,
  sizeSm: 13,
  sizeMd: 15,
  sizeLg: 18,
  sizeXl: 24,
  sizeXxl: 32,
};

export const Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.7,
    shadowRadius: 32,
    elevation: 16,
  },
  accent: {
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
};
