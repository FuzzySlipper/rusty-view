/**
 * Stable CSS custom-property *names* for rusty-view design tokens.
 *
 * Only the names (the `--rv-*` identifiers) live here. The *values* live in
 * `../styles/tokens.css`. Components reference tokens via CSS `var()` in their
 * component-scoped styles; these constants exist so that any programmatic
 * reference to a token name is type-checked and refactor-safe instead of a
 * magic string. No app-specific theme assumptions, no roleplay concepts.
 */

export const COLOR_TOKENS = {
  bg: '--rv-color-bg',
  surface: '--rv-color-surface',
  surfaceRaised: '--rv-color-surface-raised',
  border: '--rv-color-border',
  borderStrong: '--rv-color-border-strong',
  textPrimary: '--rv-color-text-primary',
  textSecondary: '--rv-color-text-secondary',
  textMuted: '--rv-color-text-muted',
  accent: '--rv-color-accent',
  accentHover: '--rv-color-accent-hover',
  accentText: '--rv-color-accent-text',
  success: '--rv-color-success',
  warning: '--rv-color-warning',
  danger: '--rv-color-danger',
  stream: '--rv-color-stream',
} as const;

export const SPACING_TOKENS = {
  none: '--rv-space-0',
  xs: '--rv-space-xs',
  sm: '--rv-space-sm',
  md: '--rv-space-md',
  lg: '--rv-space-lg',
  xl: '--rv-space-xl',
} as const;

export const TYPOGRAPHY_TOKENS = {
  fontFamilyMono: '--rv-font-mono',
  fontFamilySans: '--rv-font-sans',
  fontSizeXs: '--rv-font-size-xs',
  fontSizeSm: '--rv-font-size-sm',
  fontSizeMd: '--rv-font-size-md',
  fontSizeLg: '--rv-font-size-lg',
  lineHeightTight: '--rv-line-height-tight',
  lineHeightNormal: '--rv-line-height-normal',
  fontWeightRegular: '--rv-font-weight-regular',
  fontWeightBold: '--rv-font-weight-bold',
} as const;

export const DENSITY_TOKENS = {
  controlHeightSm: '--rv-density-control-sm',
  controlHeightMd: '--rv-density-control-md',
  rowHeight: '--rv-density-row',
  borderRadius: '--rv-radius',
} as const;

export const Z_INDEX_TOKENS = {
  base: '--rv-z-base',
  sticky: '--rv-z-sticky',
  overlay: '--rv-z-overlay',
} as const;

export const MOTION_TOKENS = {
  fast: '--rv-motion-fast',
  base: '--rv-motion-base',
} as const;

/**
 * Union of every design-token custom-property name. Use this to type any
 * programmatic token reference.
 */
export type DesignTokenName =
  | (typeof COLOR_TOKENS)[keyof typeof COLOR_TOKENS]
  | (typeof SPACING_TOKENS)[keyof typeof SPACING_TOKENS]
  | (typeof TYPOGRAPHY_TOKENS)[keyof typeof TYPOGRAPHY_TOKENS]
  | (typeof DENSITY_TOKENS)[keyof typeof DENSITY_TOKENS]
  | (typeof Z_INDEX_TOKENS)[keyof typeof Z_INDEX_TOKENS]
  | (typeof MOTION_TOKENS)[keyof typeof MOTION_TOKENS];
