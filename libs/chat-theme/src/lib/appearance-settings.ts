/**
 * Appearance settings model for rusty-view.
 *
 * These are the user-tunable visual values surfaced by the Options → Appearance
 * tab. They are *not* design tokens themselves — they are a small, typed
 * preferences object that the {@link ChatTheme} service translates into live
 * `--rv-*` CSS custom properties on the document root. Keeping them separate
 * from the raw token names means downstream consumers (e.g. rusty-roleplay)
 * can override defaults via the {@link CHAT_THEME} token without re-implementing
 * the application logic.
 *
 * No roleplay concepts. Values are debug-appropriate: industrial, dense.
 */

/**
 * Which typeface the chat stream / app prose renders in. `system` is the
 * default sans stack; `mono` flattens prose to the monospace stack for a
 * terminal/debug feel. Applied by overriding the `--rv-font-sans` token.
 */
export type AppearanceFontFamily = 'system' | 'mono';

/**
 * Density of controls and rows. `compact` shrinks the density tokens toward a
 * tighter workbench feel; `normal` is the token default.
 */
export type AppearanceDensity = 'compact' | 'normal';

/**
 * Colour overrides for the core surface/text/accent tokens. Every field is
 * optional — `undefined` means "use the token default" (the value is removed
 * from the document root so the `tokens.css` cascade wins).
 */
export interface AppearanceColors {
  /** Page/background (`--rv-color-bg`). */
  readonly bg?: string;
  /** Panels and bars (`--rv-color-surface`). */
  readonly surface?: string;
  /** Raised surfaces / buttons (`--rv-color-surface-raised`). */
  readonly surfaceRaised?: string;
  /** Dividers (`--rv-color-border`). */
  readonly border?: string;
  /** Primary text (`--rv-color-text-primary`). */
  readonly textPrimary?: string;
  /** Secondary text (`--rv-color-text-secondary`). */
  readonly textSecondary?: string;
  /** Accent / selection (`--rv-color-accent`). */
  readonly accent?: string;
}

/**
 * How text blocks in the transcript are rendered. See {@link AppearanceSettings.textRenderMode}.
 */
export type TextRenderMode = 'auto' | 'raw' | 'markdown' | 'sanitized-html';

/**
 * Complete appearance preferences. Stored verbatim via the settings storage
 * adapter; never includes secrets or auth material.
 */
export interface AppearanceSettings {
  readonly fontFamily: AppearanceFontFamily;
  /**
   * Multiplier applied to the base font-size tokens. `1` is the token default;
   * `0.85` is tighter, `1.25` is larger. Clamped to
   * {@link FONT_SCALE_MIN}..{@link FONT_SCALE_MAX}.
   */
  readonly fontScale: number;
  readonly density: AppearanceDensity;
  readonly colors: AppearanceColors;
  /**
   * How chat message text is rendered: `auto` (detect Markdown/HTML per block),
   * `raw` (plain text), `markdown` (formatted Markdown), or `sanitized-html`
   * (inline HTML with sanitization). Users can also toggle individual blocks
   * to raw via a per-block control.
   */
  readonly textRenderMode: TextRenderMode;
}

/** Inclusive bounds for {@link AppearanceSettings.fontScale}. */
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.5;
/** Step used by the Appearance tab slider. */
export const FONT_SCALE_STEP = 0.05;

/**
 * Base font-size pixel values. These mirror `libs/design-tokens/src/styles/
 * tokens.css` and are the anchors the font-scale multiplier is applied to. If
 * the token defaults change, update these to match.
 */
export const BASE_FONT_SIZES = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 15,
} as const;

/**
 * Base density pixel values (mirror `tokens.css`). Scaled by the density
 * preference.
 */
export const BASE_DENSITY = {
  controlSm: 24,
  controlMd: 30,
  row: 28,
} as const;

/** Density multipliers — `normal` is identity. */
const DENSITY_MULTIPLIERS: Readonly<Record<AppearanceDensity, number>> = {
  compact: 0.86,
  normal: 1,
};

/** Default, debug-appropriate appearance. */
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: 'system',
  fontScale: 1,
  density: 'normal',
  colors: {},
  textRenderMode: 'auto',
};

/** Clamp a font scale into the allowed range and round to a sane precision. */
export function clampFontScale(value: number): number {
  if (Number.isNaN(value)) return 1;
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
  return Math.round(clamped * 100) / 100;
}

/** Density multiplier for a given preference (1 for normal). */
export function densityMultiplier(density: AppearanceDensity): number {
  return DENSITY_MULTIPLIERS[density];
}
