import { DOCUMENT } from '@angular/common';
import {
  effect,
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';

import {
  COLOR_TOKENS,
  DENSITY_TOKENS,
  LAYOUT_TOKENS,
  MOTION_TOKENS,
  SHADOW_TOKENS,
  TYPOGRAPHY_TOKENS,
} from '@rusty-view/design-tokens';

import {
  type AppearanceColors,
  type AppearanceBackgroundPreset,
  type AppearanceDensity,
  type AppearanceFontFamily,
  type AppearanceSettings,
  type AppearanceSyntaxTheme,
  type TextRenderMode,
  APPEARANCE_BACKGROUND_PRESETS,
  APPEARANCE_COLOR_FIELDS,
  BASE_DENSITY,
  BASE_FONT_SIZES,
  clampChatWidthPercent,
  clampComposerHeightPx,
  clampFontScale,
  clampSidebarWidthPx,
  DEFAULT_APPEARANCE,
  densityMultiplier,
  MESSAGE_SPACING_Y,
  normalizeBackgroundPreset,
  normalizeFontFamily,
  normalizeMessageSpacing,
  normalizeSyntaxTheme,
  normalizeThemeId,
} from './appearance-settings';
import { CHAT_SETTINGS_STORAGE } from './chat-settings-storage';
import { CHAT_THEME } from './chat-theme-token';

/**
 * Maps every colour preference field to the token name it overrides (task
 * #3691). Mirrors `AppearanceColors`/`COLOR_TOKENS` so the whole semantic
 * palette is reachable by a theme, not a hand-maintained subset.
 */
const COLOR_FIELD_TOKENS: Readonly<Record<keyof AppearanceColors, string>> = {
  bg: COLOR_TOKENS.bg,
  surface: COLOR_TOKENS.surface,
  surfaceRaised: COLOR_TOKENS.surfaceRaised,
  surfaceAlt: COLOR_TOKENS.surfaceAlt,
  surfaceDisabled: COLOR_TOKENS.surfaceDisabled,
  border: COLOR_TOKENS.border,
  borderStrong: COLOR_TOKENS.borderStrong,
  textPrimary: COLOR_TOKENS.textPrimary,
  textSecondary: COLOR_TOKENS.textSecondary,
  textMuted: COLOR_TOKENS.textMuted,
  accent: COLOR_TOKENS.accent,
  accentHover: COLOR_TOKENS.accentHover,
  accentText: COLOR_TOKENS.accentText,
  success: COLOR_TOKENS.success,
  warning: COLOR_TOKENS.warning,
  danger: COLOR_TOKENS.danger,
  stream: COLOR_TOKENS.stream,
  scrim: COLOR_TOKENS.scrim,
};

/**
 * The complete set of `--rv-*` custom-property names this service manages.
 * Anything in this set is removed before re-applying, so a reset returns the
 * document to the `tokens.css` cascade (including any `data-rv-theme` block).
 */
const MANAGED_TOKENS: readonly string[] = [
  TYPOGRAPHY_TOKENS.fontFamilyUi,
  TYPOGRAPHY_TOKENS.fontFamilySans,
  TYPOGRAPHY_TOKENS.fontFamilyTechnical,
  TYPOGRAPHY_TOKENS.fontSizeXs,
  TYPOGRAPHY_TOKENS.fontSizeSm,
  TYPOGRAPHY_TOKENS.fontSizeMd,
  TYPOGRAPHY_TOKENS.fontSizeLg,
  DENSITY_TOKENS.controlHeightSm,
  DENSITY_TOKENS.controlHeightMd,
  DENSITY_TOKENS.rowHeight,
  SHADOW_TOKENS.sm,
  SHADOW_TOKENS.overlay,
  MOTION_TOKENS.fast,
  MOTION_TOKENS.base,
  LAYOUT_TOKENS.chatWidth,
  LAYOUT_TOKENS.messagePaddingY,
  LAYOUT_TOKENS.composerHeight,
  LAYOUT_TOKENS.sidebarWidth,
  ...Object.values(COLOR_FIELD_TOKENS),
];

/** The data attribute on the document root used to select a named base theme. */
const THEME_DATA_ATTRIBUTE = 'data-rv-theme';
const SHOW_TIMESTAMPS_ATTRIBUTE = 'data-rv-show-timestamps';
const SHOW_MESSAGE_IDS_ATTRIBUTE = 'data-rv-show-message-ids';
const REDUCED_MOTION_ATTRIBUTE = 'data-rv-reduced-motion';
const DISABLE_SHADOWS_ATTRIBUTE = 'data-rv-disable-shadows';
const BACKGROUND_PRESET_ATTRIBUTE = 'data-rv-background-preset';
const SYNTAX_THEME_ATTRIBUTE = 'data-rv-syntax-theme';

const FONT_FAMILY_STACKS: Readonly<Record<AppearanceFontFamily, string>> = {
  system:
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  readable:
    "'Atkinson Hyperlegible', Aptos, 'Segoe UI', Verdana, Tahoma, sans-serif",
  verdana: "Verdana, Geneva, 'Segoe UI', sans-serif",
  arial: "Arial, Helvetica, 'Segoe UI', sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  'classic-serif': "'Times New Roman', Times, Georgia, serif",
  mono: `var(${TYPOGRAPHY_TOKENS.fontFamilyMono})`,
  dyslexic:
    "'OpenDyslexic', 'Atkinson Hyperlegible', Verdana, Tahoma, sans-serif",
};

const BACKGROUND_PRESETS = new Set<AppearanceBackgroundPreset>(
  APPEARANCE_BACKGROUND_PRESETS.map((preset) => preset.id),
);

/**
 * Angular Signals service that owns appearance preferences and applies them
 * live to the document root as `--rv-*` CSS custom properties.
 *
 * Responsibilities:
 *   - Hold the current {@link AppearanceSettings} as a readonly signal.
 *   - Translate settings into token overrides on `document.documentElement`
 *     so the whole app (transcript + shell) updates live via `var(--rv-*)`.
 *   - Persist/reload settings through {@link CHAT_SETTINGS_STORAGE} (IndexedDB
 *     in production — never `localStorage`/`sessionStorage`).
 *
 * Not injectable-tree-rooted by default to keep it testable; the shell provides
 * it. It has no downstream product knowledge.
 */
@Injectable()
export class ChatTheme {
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(CHAT_SETTINGS_STORAGE, { optional: true });
  private readonly injector = inject(Injector);
  private readonly themeDefaults = inject(CHAT_THEME, { optional: true }) ?? {};
  private readonly defaultSettings = this.normalize({
    ...DEFAULT_APPEARANCE,
    ...this.themeDefaults,
    colors: { ...DEFAULT_APPEARANCE.colors, ...this.themeDefaults.colors },
  });

  private readonly _settings = signal<AppearanceSettings>(this.defaultSettings);
  /** Monotonic guard against a late startup load replacing a user change. */
  private settingsRevision = 0;
  /** Serializes whole-object snapshots so an older IndexedDB write cannot win. */
  private persistQueue: Promise<void> = Promise.resolve();

  /** Current appearance preferences (readonly). */
  readonly settings = this._settings.asReadonly();

  constructor() {
    // Apply settings to the DOM whenever they change. runInInjectionContext is
    // used so the effect is created against this service's injector even when
    // the service is constructed outside a component context (e.g. in tests).
    runInInjectionContext(this.injector, () => {
      effect(() => {
        this.applyToDom(this._settings());
      });
    });

    // Load persisted settings (fire and forget — defaults remain on failure).
    void this.load();
  }

  /**
   * Replace the entire appearance with the given settings (validated). The
   * change is applied live and persisted.
   */
  async set(settings: AppearanceSettings): Promise<void> {
    const normalized = this.normalize(settings);
    this.settingsRevision++;
    this._settings.set(normalized);
    await this.persist(normalized);
  }

  /**
   * Merge a partial update into the current settings, apply live, and persist.
   * `colors` is deep-merged so callers can override a single colour.
   */
  async update(
    patch: Partial<Omit<AppearanceSettings, 'colors'>> & {
      readonly colors?: Partial<AppearanceColors>;
    },
  ): Promise<void> {
    const next = this.normalize({
      ...this._settings(),
      ...patch,
      colors: { ...this._settings().colors, ...patch.colors },
    });
    this.settingsRevision++;
    this._settings.set(next);
    await this.persist(next);
  }

  /** Select a named base theme (task #3691), apply live, and persist. */
  async setTheme(themeId: AppearanceSettings['themeId']): Promise<void> {
    await this.update({ themeId });
  }

  /** Reset to the host-provided default baseline, apply live, and persist. */
  async reset(): Promise<void> {
    this.settingsRevision++;
    this._settings.set(this.defaultSettings);
    await this.persist(this.defaultSettings);
  }

  // ---- internals ----

  /** Load persisted settings into the signal (no further persist). */
  private async load(): Promise<void> {
    if (this.storage === null) return;
    const revisionAtStart = this.settingsRevision;
    const stored = await this.storage.load();
    if (stored !== null && this.settingsRevision === revisionAtStart) {
      this._settings.set(this.normalize(stored));
    }
  }

  private async persist(settings: AppearanceSettings): Promise<void> {
    if (this.storage === null) return;
    const pending = this.persistQueue.then(() => this.storage?.save(settings));
    // Storage is deliberately non-fatal. Keep the queue usable even when an
    // embedding adapter rejects a write, while still awaiting this snapshot.
    this.persistQueue = pending.catch(() => undefined);
    await this.persistQueue;
  }

  /**
   * Export the current appearance settings as a pretty-printed JSON string for
   * sharing/backup (task #3691). Contains no secrets.
   */
  exportTheme(): string {
    return JSON.stringify(this._settings(), null, 2);
  }

  /**
   * Import appearance settings from a JSON string (task #3691). Invalid JSON or
   * fields are rejected/normalized rather than throwing; returns true when the
   * input parsed as an object and was applied.
   */
  async importTheme(json: string): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return false;
    }
    if (typeof parsed !== 'object' || parsed === null) return false;
    await this.set(this.normalize(parsed as Partial<AppearanceSettings>));
    return true;
  }

  /** Coerce arbitrary settings into a valid, clamped {@link AppearanceSettings}. */
  private normalize(settings: Partial<AppearanceSettings>): AppearanceSettings {
    const density: AppearanceDensity =
      settings.density === 'compact' ? 'compact' : 'normal';
    return {
      themeId: normalizeThemeId(settings.themeId),
      fontFamily: normalizeFontFamily(settings.fontFamily),
      // Stored settings from before task #6203 do not contain the technical
      // role. Preserve their established monospace rendering on migration.
      technicalFontFamily: normalizeFontFamily(
        settings.technicalFontFamily ?? DEFAULT_APPEARANCE.technicalFontFamily,
      ),
      fontScale: clampFontScale(settings.fontScale ?? 1),
      density,
      messageSpacing: normalizeMessageSpacing(settings.messageSpacing),
      chatWidthPercent: clampChatWidthPercent(settings.chatWidthPercent ?? 100),
      composerHeightPx: clampComposerHeightPx(
        settings.composerHeightPx ?? DEFAULT_APPEARANCE.composerHeightPx,
      ),
      sidebarWidthPx: clampSidebarWidthPx(
        settings.sidebarWidthPx ?? DEFAULT_APPEARANCE.sidebarWidthPx,
      ),
      reducedMotion: settings.reducedMotion === true,
      disableShadows: settings.disableShadows === true,
      showTimestamps: settings.showTimestamps === true,
      showMessageIds: settings.showMessageIds === true,
      // Persisted objects from before task #5745 do not contain these fields;
      // absence must preserve the established visible-by-default shell.
      showMessageActions: settings.showMessageActions !== false,
      autoExpandReasoning: settings.autoExpandReasoning === true,
      showSessionStatusBar: settings.showSessionStatusBar !== false,
      showProfiles: settings.showProfiles !== false,
      showInspector: settings.showInspector !== false,
      backgroundPreset: normalizeBackgroundPreset(settings.backgroundPreset),
      syntaxTheme: normalizeSyntaxTheme(
        settings.syntaxTheme ?? DEFAULT_APPEARANCE.syntaxTheme,
      ),
      colors: normalizeColors(settings.colors),
      textRenderMode: normalizeTextRenderMode(settings.textRenderMode),
    };
  }

  /**
   * Apply settings to `documentElement` as token overrides. Removes every
   * managed token first so unset fields fall back to `tokens.css`.
   */
  private applyToDom(settings: AppearanceSettings): void {
    const root = this.document.documentElement;

    // Named base theme: select a palette block via the data attribute. `auto`
    // removes it so the `prefers-color-scheme` cascade wins.
    if (settings.themeId === 'auto') {
      root.removeAttribute(THEME_DATA_ATTRIBUTE);
    } else {
      root.setAttribute(THEME_DATA_ATTRIBUTE, settings.themeId);
    }
    this.setBooleanAttribute(
      root,
      SHOW_TIMESTAMPS_ATTRIBUTE,
      settings.showTimestamps,
    );
    this.setBooleanAttribute(
      root,
      SHOW_MESSAGE_IDS_ATTRIBUTE,
      settings.showMessageIds,
    );
    this.setBooleanAttribute(
      root,
      REDUCED_MOTION_ATTRIBUTE,
      settings.reducedMotion,
    );
    this.setBooleanAttribute(
      root,
      DISABLE_SHADOWS_ATTRIBUTE,
      settings.disableShadows,
    );
    if (
      settings.backgroundPreset === 'none' ||
      !BACKGROUND_PRESETS.has(settings.backgroundPreset)
    ) {
      root.removeAttribute(BACKGROUND_PRESET_ATTRIBUTE);
    } else {
      root.setAttribute(BACKGROUND_PRESET_ATTRIBUTE, settings.backgroundPreset);
    }
    this.applySyntaxTheme(root, settings.syntaxTheme);

    // Clear all managed overrides so defaults cascade cleanly.
    for (const token of MANAGED_TOKENS) {
      root.style.removeProperty(token);
    }

    // The two deliberate typography roles are independently configurable.
    // `--rv-font-mono` remains the base monospace stack used by the "Mono"
    // choice; user-facing technical surfaces consume `--rv-font-technical`.
    const fontStack = FONT_FAMILY_STACKS[settings.fontFamily];
    root.style.setProperty(TYPOGRAPHY_TOKENS.fontFamilyUi, fontStack);
    root.style.setProperty(TYPOGRAPHY_TOKENS.fontFamilySans, fontStack);
    root.style.setProperty(
      TYPOGRAPHY_TOKENS.fontFamilyTechnical,
      FONT_FAMILY_STACKS[settings.technicalFontFamily],
    );

    // Font scale: recompute the size tokens from the base anchors.
    const scale = settings.fontScale;
    root.style.setProperty(
      TYPOGRAPHY_TOKENS.fontSizeXs,
      `${Math.round(BASE_FONT_SIZES.xs * scale)}px`,
    );
    root.style.setProperty(
      TYPOGRAPHY_TOKENS.fontSizeSm,
      `${Math.round(BASE_FONT_SIZES.sm * scale)}px`,
    );
    root.style.setProperty(
      TYPOGRAPHY_TOKENS.fontSizeMd,
      `${Math.round(BASE_FONT_SIZES.md * scale)}px`,
    );
    root.style.setProperty(
      TYPOGRAPHY_TOKENS.fontSizeLg,
      `${Math.round(BASE_FONT_SIZES.lg * scale)}px`,
    );

    // Density: scale the density tokens.
    const mult = densityMultiplier(settings.density);
    root.style.setProperty(
      DENSITY_TOKENS.controlHeightSm,
      `${Math.round(BASE_DENSITY.controlSm * mult)}px`,
    );
    root.style.setProperty(
      DENSITY_TOKENS.controlHeightMd,
      `${Math.round(BASE_DENSITY.controlMd * mult)}px`,
    );
    root.style.setProperty(
      DENSITY_TOKENS.rowHeight,
      `${Math.round(BASE_DENSITY.row * mult)}px`,
    );
    root.style.setProperty(
      LAYOUT_TOKENS.messagePaddingY,
      `${MESSAGE_SPACING_Y[settings.messageSpacing]}px`,
    );
    root.style.setProperty(
      LAYOUT_TOKENS.chatWidth,
      `${settings.chatWidthPercent}%`,
    );
    root.style.setProperty(
      LAYOUT_TOKENS.composerHeight,
      `${settings.composerHeightPx}px`,
    );
    root.style.setProperty(
      LAYOUT_TOKENS.sidebarWidth,
      `${settings.sidebarWidthPx}px`,
    );

    if (settings.reducedMotion) {
      root.style.setProperty(MOTION_TOKENS.fast, '0ms');
      root.style.setProperty(MOTION_TOKENS.base, '0ms');
    }
    if (settings.disableShadows) {
      root.style.setProperty(SHADOW_TOKENS.sm, 'none');
      root.style.setProperty(SHADOW_TOKENS.overlay, 'none');
    }

    // Colours: set each provided override; unset ones were already removed.
    // Iterating the full field map keeps every semantic colour theme-able.
    for (const { key } of APPEARANCE_COLOR_FIELDS) {
      this.applyColor(root, COLOR_FIELD_TOKENS[key], settings.colors[key]);
    }
  }

  private applyColor(
    root: HTMLElement,
    token: string,
    value: string | undefined,
  ): void {
    if (value !== undefined && value.trim() !== '') {
      root.style.setProperty(token, value);
    }
  }

  private setBooleanAttribute(
    root: HTMLElement,
    attribute: string,
    enabled: boolean,
  ): void {
    if (enabled) {
      root.setAttribute(attribute, 'true');
    } else {
      root.removeAttribute(attribute);
    }
  }

  private applySyntaxTheme(
    root: HTMLElement,
    syntaxTheme: AppearanceSyntaxTheme,
  ): void {
    if (syntaxTheme === 'off') {
      root.removeAttribute(SYNTAX_THEME_ATTRIBUTE);
      return;
    }
    root.setAttribute(SYNTAX_THEME_ATTRIBUTE, syntaxTheme);
  }
}

/**
 * Sanitize an arbitrary colour map: keep only known fields with non-empty
 * string values (task #3691). Guards the import path against junk keys/values.
 */
function normalizeColors(
  colors: Partial<AppearanceColors> | undefined,
): AppearanceColors {
  if (typeof colors !== 'object' || colors === null) return {};
  const result: { -readonly [K in keyof AppearanceColors]?: string } = {};
  for (const { key } of APPEARANCE_COLOR_FIELDS) {
    const value = (colors as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim() !== '') {
      result[key] = value;
    }
  }
  return result;
}

/** Coerce an arbitrary text render mode into a valid value. */
function normalizeTextRenderMode(
  mode: TextRenderMode | undefined,
): TextRenderMode {
  if (
    mode === 'auto' ||
    mode === 'raw' ||
    mode === 'markdown' ||
    mode === 'sanitized-html'
  ) {
    return mode;
  }
  return 'auto';
}
