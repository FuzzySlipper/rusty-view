/**
 * Appearance settings model for rusty-view.
 *
 * These are the user-tunable visual values surfaced by the Options → Appearance
 * tab. They are *not* design tokens themselves — they are a small, typed
 * preferences object that the {@link ChatTheme} service translates into live
 * `--rv-*` CSS custom properties on the document root. Keeping them separate
 * from the raw token names means downstream consumers can override defaults via
 * the {@link CHAT_THEME} token without re-implementing the application logic.
 *
 * No downstream product concepts. Values are debug-appropriate: industrial,
 * dense.
 */

/**
 * Which typeface the app and chat prose render in. Applied by overriding the
 * `--rv-font-sans` and `--rv-font-ui` tokens while keeping `--rv-font-mono`
 * available for semantic code, event, and JSON detail surfaces.
 */
export type AppearanceFontFamily =
  | 'system'
  | 'readable'
  | 'verdana'
  | 'arial'
  | 'serif'
  | 'classic-serif'
  | 'mono'
  | 'dyslexic';

/** Ordered font-family choices for the Appearance selector. */
export const APPEARANCE_FONT_FAMILIES: ReadonlyArray<{
  readonly id: AppearanceFontFamily;
  readonly label: string;
}> = [
  { id: 'system', label: 'System' },
  { id: 'readable', label: 'Readable' },
  { id: 'verdana', label: 'Verdana' },
  { id: 'arial', label: 'Arial' },
  { id: 'serif', label: 'Serif' },
  { id: 'classic-serif', label: 'Times' },
  { id: 'mono', label: 'Mono' },
  { id: 'dyslexic', label: 'Dyslexic' },
];

/**
 * Density of controls and rows. `compact` shrinks the density tokens toward a
 * tighter workbench feel; `normal` is the token default.
 */
export type AppearanceDensity = 'compact' | 'normal';

/** Vertical space inside transcript message rows. */
export type AppearanceMessageSpacing = 'compact' | 'normal' | 'roomy';

/** Ordered message spacing choices for the Appearance selector. */
export const APPEARANCE_MESSAGE_SPACING: ReadonlyArray<{
  readonly id: AppearanceMessageSpacing;
  readonly label: string;
}> = [
  { id: 'normal', label: 'Normal' },
  { id: 'compact', label: 'Compact' },
  { id: 'roomy', label: 'Roomy' },
];

/**
 * Per-token colour overrides for the full semantic colour palette (task #3691).
 * Every field is optional — `undefined` means "use the selected base theme's
 * token value" (the override is removed from the document root so the
 * `tokens.css` cascade, including any `data-rv-theme` block, wins). Field keys
 * mirror the `COLOR_TOKENS` map so the whole app can be reskinned from one
 * place rather than each component inventing its own colours.
 */
export interface AppearanceColors {
  /** Page/background (`--rv-color-bg`). */
  readonly bg?: string;
  /** Panels and bars (`--rv-color-surface`). */
  readonly surface?: string;
  /** Raised surfaces / buttons (`--rv-color-surface-raised`). */
  readonly surfaceRaised?: string;
  /** Alternate/inset surface (`--rv-color-surface-alt`). */
  readonly surfaceAlt?: string;
  /** Disabled-control fill (`--rv-color-surface-disabled`). */
  readonly surfaceDisabled?: string;
  /** Dividers (`--rv-color-border`). */
  readonly border?: string;
  /** Strong dividers/outlines (`--rv-color-border-strong`). */
  readonly borderStrong?: string;
  /** Primary text (`--rv-color-text-primary`). */
  readonly textPrimary?: string;
  /** Secondary text (`--rv-color-text-secondary`). */
  readonly textSecondary?: string;
  /** Muted text (`--rv-color-text-muted`). */
  readonly textMuted?: string;
  /** Accent / selection (`--rv-color-accent`). */
  readonly accent?: string;
  /** Accent hover (`--rv-color-accent-hover`). */
  readonly accentHover?: string;
  /** Text on accent fills (`--rv-color-accent-text`). */
  readonly accentText?: string;
  /** Success (`--rv-color-success`). */
  readonly success?: string;
  /** Warning (`--rv-color-warning`). */
  readonly warning?: string;
  /** Danger (`--rv-color-danger`). */
  readonly danger?: string;
  /** Stream/secondary accent (`--rv-color-stream`). */
  readonly stream?: string;
  /** Modal backdrop / scrim (`--rv-color-scrim`). */
  readonly scrim?: string;
}

/** Ordered list of every editable colour field plus a human label (task #3691). */
export const APPEARANCE_COLOR_FIELDS: ReadonlyArray<{
  readonly key: keyof AppearanceColors;
  readonly label: string;
}> = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface / panels' },
  { key: 'surfaceRaised', label: 'Raised surface' },
  { key: 'surfaceAlt', label: 'Alternate surface' },
  { key: 'surfaceDisabled', label: 'Disabled fill' },
  { key: 'border', label: 'Border' },
  { key: 'borderStrong', label: 'Border (strong)' },
  { key: 'textPrimary', label: 'Text (primary)' },
  { key: 'textSecondary', label: 'Text (secondary)' },
  { key: 'textMuted', label: 'Text (muted)' },
  { key: 'accent', label: 'Accent / selection' },
  { key: 'accentHover', label: 'Accent (hover)' },
  { key: 'accentText', label: 'Text on accent' },
  { key: 'success', label: 'Success' },
  { key: 'warning', label: 'Warning' },
  { key: 'danger', label: 'Danger' },
  { key: 'stream', label: 'Stream' },
  { key: 'scrim', label: 'Modal scrim' },
];

/**
 * Selected named base theme (task #3691). `auto` follows the OS
 * `prefers-color-scheme`; the others force a palette via the `data-rv-theme`
 * attribute. Per-token {@link AppearanceColors} overrides layer on top.
 */
export type AppearanceThemeId = 'auto' | 'dark' | 'light' | 'high-contrast';

/** Ordered named themes with labels for the appearance selector (task #3691). */
export const APPEARANCE_THEMES: ReadonlyArray<{
  readonly id: AppearanceThemeId;
  readonly label: string;
}> = [
  { id: 'auto', label: 'Auto (system)' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'high-contrast', label: 'High contrast' },
];

/** App-level background treatment applied behind the reusable chat shell. */
export type AppearanceBackgroundPreset = 'none' | 'grid' | 'scanlines';

/** Ordered background choices for the Appearance selector. */
export const APPEARANCE_BACKGROUND_PRESETS: ReadonlyArray<{
  readonly id: AppearanceBackgroundPreset;
  readonly label: string;
}> = [
  { id: 'none', label: 'None' },
  { id: 'grid', label: 'Subtle grid' },
  { id: 'scanlines', label: 'Scanlines' },
];

/**
 * How text blocks in the transcript are rendered. See {@link AppearanceSettings.textRenderMode}.
 */
export type TextRenderMode = 'auto' | 'raw' | 'markdown' | 'sanitized-html';

/**
 * Complete appearance preferences. Stored verbatim via the settings storage
 * adapter; never includes secrets or auth material.
 */
export interface AppearanceSettings {
  /** Selected named base theme (task #3691). Defaults to `auto`. */
  readonly themeId: AppearanceThemeId;
  readonly fontFamily: AppearanceFontFamily;
  /**
   * Multiplier applied to the base font-size tokens. `1` is the token default;
   * `0.85` is tighter, `1.25` is larger. Clamped to
   * {@link FONT_SCALE_MIN}..{@link FONT_SCALE_MAX}.
   */
  readonly fontScale: number;
  readonly density: AppearanceDensity;
  readonly messageSpacing: AppearanceMessageSpacing;
  readonly chatWidthPercent: number;
  readonly reducedMotion: boolean;
  readonly disableShadows: boolean;
  readonly showTimestamps: boolean;
  readonly showMessageIds: boolean;
  readonly backgroundPreset: AppearanceBackgroundPreset;
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

/** Inclusive bounds for {@link AppearanceSettings.chatWidthPercent}. */
export const CHAT_WIDTH_MIN = 45;
export const CHAT_WIDTH_MAX = 100;
export const CHAT_WIDTH_STEP = 5;

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

/** Vertical padding per message row, in pixels. */
export const MESSAGE_SPACING_Y: Readonly<
  Record<AppearanceMessageSpacing, number>
> = {
  compact: 2,
  normal: 4,
  roomy: 8,
};

/** Default, debug-appropriate appearance. */
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeId: 'auto',
  fontFamily: 'system',
  fontScale: 1,
  density: 'normal',
  messageSpacing: 'normal',
  chatWidthPercent: 100,
  reducedMotion: false,
  disableShadows: false,
  showTimestamps: false,
  showMessageIds: false,
  backgroundPreset: 'none',
  colors: {},
  textRenderMode: 'auto',
};

/** Coerce an arbitrary value into a valid font-family choice. */
export function normalizeFontFamily(value: unknown): AppearanceFontFamily {
  return value === 'readable' ||
    value === 'verdana' ||
    value === 'arial' ||
    value === 'serif' ||
    value === 'classic-serif' ||
    value === 'mono' ||
    value === 'dyslexic' ||
    value === 'system'
    ? value
    : 'system';
}

/** Coerce an arbitrary value into a valid message spacing choice. */
export function normalizeMessageSpacing(
  value: unknown,
): AppearanceMessageSpacing {
  return value === 'compact' || value === 'roomy' || value === 'normal'
    ? value
    : 'normal';
}

/** Coerce an arbitrary value into a valid named theme id (task #3691). */
export function normalizeThemeId(value: unknown): AppearanceThemeId {
  return value === 'dark' ||
    value === 'light' ||
    value === 'high-contrast' ||
    value === 'auto'
    ? value
    : 'auto';
}

/** Coerce an arbitrary value into a valid background preset. */
export function normalizeBackgroundPreset(
  value: unknown,
): AppearanceBackgroundPreset {
  return value === 'grid' || value === 'scanlines' || value === 'none'
    ? value
    : 'none';
}

/** Clamp a font scale into the allowed range and round to a sane precision. */
export function clampFontScale(value: number): number {
  if (Number.isNaN(value)) return 1;
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
  return Math.round(clamped * 100) / 100;
}

/** Clamp transcript width into the allowed range and round for persistence. */
export function clampChatWidthPercent(value: number): number {
  if (Number.isNaN(value)) return 100;
  const clamped = Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, value));
  return Math.round(clamped);
}

/** Density multiplier for a given preference (1 for normal). */
export function densityMultiplier(density: AppearanceDensity): number {
  return DENSITY_MULTIPLIERS[density];
}
