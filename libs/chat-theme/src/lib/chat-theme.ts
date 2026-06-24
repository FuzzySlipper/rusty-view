import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';

import {
  COLOR_TOKENS,
  DENSITY_TOKENS,
  TYPOGRAPHY_TOKENS,
} from '@rusty-view/design-tokens';

import {
  type AppearanceColors,
  type AppearanceDensity,
  type AppearanceFontFamily,
  type AppearanceSettings,
  type TextRenderMode,
  BASE_DENSITY,
  BASE_FONT_SIZES,
  clampFontScale,
  DEFAULT_APPEARANCE,
  densityMultiplier,
} from './appearance-settings';
import { CHAT_SETTINGS_STORAGE } from './chat-settings-storage';

/**
 * The complete set of `--rv-*` custom-property names this service manages.
 * Anything in this set is removed before re-applying, so a reset returns the
 * document to the `tokens.css` cascade.
 */
const MANAGED_TOKENS: readonly string[] = [
  TYPOGRAPHY_TOKENS.fontFamilySans,
  TYPOGRAPHY_TOKENS.fontSizeXs,
  TYPOGRAPHY_TOKENS.fontSizeSm,
  TYPOGRAPHY_TOKENS.fontSizeMd,
  TYPOGRAPHY_TOKENS.fontSizeLg,
  DENSITY_TOKENS.controlHeightSm,
  DENSITY_TOKENS.controlHeightMd,
  DENSITY_TOKENS.rowHeight,
  COLOR_TOKENS.bg,
  COLOR_TOKENS.surface,
  COLOR_TOKENS.surfaceRaised,
  COLOR_TOKENS.border,
  COLOR_TOKENS.textPrimary,
  COLOR_TOKENS.textSecondary,
  COLOR_TOKENS.accent,
];

/**
 * Maps a colour preference field to the token name it overrides.
 */
const COLOR_FIELD_TOKENS: Readonly<Record<keyof AppearanceColors, string>> = {
  bg: COLOR_TOKENS.bg,
  surface: COLOR_TOKENS.surface,
  surfaceRaised: COLOR_TOKENS.surfaceRaised,
  border: COLOR_TOKENS.border,
  textPrimary: COLOR_TOKENS.textPrimary,
  textSecondary: COLOR_TOKENS.textSecondary,
  accent: COLOR_TOKENS.accent,
};

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
 * it. It has no roleplay knowledge.
 */
@Injectable()
export class ChatTheme {
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(CHAT_SETTINGS_STORAGE, { optional: true });
  private readonly injector = inject(Injector);

  private readonly _settings = signal<AppearanceSettings>(DEFAULT_APPEARANCE);

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
    this._settings.set(next);
    await this.persist(next);
  }

  /** Reset to defaults, apply live, and persist. */
  async reset(): Promise<void> {
    this._settings.set(DEFAULT_APPEARANCE);
    await this.persist(DEFAULT_APPEARANCE);
  }

  // ---- internals ----

  /** Load persisted settings into the signal (no further persist). */
  private async load(): Promise<void> {
    if (this.storage === null) return;
    const stored = await this.storage.load();
    if (stored !== null) {
      this._settings.set(this.normalize(stored));
    }
  }

  private async persist(settings: AppearanceSettings): Promise<void> {
    if (this.storage === null) return;
    await this.storage.save(settings);
  }

  /** Coerce arbitrary settings into a valid, clamped {@link AppearanceSettings}. */
  private normalize(settings: Partial<AppearanceSettings>): AppearanceSettings {
    const fontFamily: AppearanceFontFamily =
      settings.fontFamily === 'mono' ? 'mono' : 'system';
    const density: AppearanceDensity =
      settings.density === 'compact' ? 'compact' : 'normal';
    return {
      fontFamily,
      fontScale: clampFontScale(settings.fontScale ?? 1),
      density,
      colors: { ...settings.colors },
      textRenderMode: normalizeTextRenderMode(settings.textRenderMode),
    };
  }

  /**
   * Apply settings to `documentElement` as token overrides. Removes every
   * managed token first so unset fields fall back to `tokens.css`.
   */
  private applyToDom(settings: AppearanceSettings): void {
    const root = this.document.documentElement;

    // Clear all managed overrides so defaults cascade cleanly.
    for (const token of MANAGED_TOKENS) {
      root.style.removeProperty(token);
    }

    // Font family: mono flattens the prose stack onto the mono stack.
    if (settings.fontFamily === 'mono') {
      root.style.setProperty(
        TYPOGRAPHY_TOKENS.fontFamilySans,
        `var(${TYPOGRAPHY_TOKENS.fontFamilyMono})`,
      );
    }

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

    // Colours: set each provided override; unset ones were already removed.
    this.applyColor(root, COLOR_FIELD_TOKENS.bg, settings.colors.bg);
    this.applyColor(root, COLOR_FIELD_TOKENS.surface, settings.colors.surface);
    this.applyColor(
      root,
      COLOR_FIELD_TOKENS.surfaceRaised,
      settings.colors.surfaceRaised,
    );
    this.applyColor(root, COLOR_FIELD_TOKENS.border, settings.colors.border);
    this.applyColor(
      root,
      COLOR_FIELD_TOKENS.textPrimary,
      settings.colors.textPrimary,
    );
    this.applyColor(
      root,
      COLOR_FIELD_TOKENS.textSecondary,
      settings.colors.textSecondary,
    );
    this.applyColor(root, COLOR_FIELD_TOKENS.accent, settings.colors.accent);
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
}

/** Coerce an arbitrary text render mode into a valid value. */
function normalizeTextRenderMode(
  mode: TextRenderMode | undefined,
): TextRenderMode {
  if (mode === 'raw' || mode === 'markdown' || mode === 'sanitized-html') {
    return mode;
  }
  return 'markdown';
}
