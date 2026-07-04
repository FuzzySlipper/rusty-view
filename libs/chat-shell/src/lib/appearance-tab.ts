import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  type AppearanceColors,
  type AppearanceDensity,
  type AppearanceFontFamily,
  type AppearanceMessageSpacing,
  type AppearanceThemeId,
  type TextRenderMode,
  APPEARANCE_COLOR_FIELDS,
  APPEARANCE_FONT_FAMILIES,
  APPEARANCE_MESSAGE_SPACING,
  APPEARANCE_THEMES,
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  CHAT_WIDTH_STEP,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  ChatTheme,
} from '@rusty-view/chat-theme';

/** Mutable, optional colour map used while building update patches. */
type MutableColors = { -readonly [K in keyof AppearanceColors]?: string };

const COLOR_PREVIEW_TOKENS: Readonly<Record<keyof AppearanceColors, string>> = {
  bg: '--rv-color-bg',
  surface: '--rv-color-surface',
  surfaceRaised: '--rv-color-surface-raised',
  surfaceAlt: '--rv-color-surface-alt',
  surfaceDisabled: '--rv-color-surface-disabled',
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
  scrim: '--rv-color-scrim',
};

/**
 * Options → Appearance tab.
 *
 * Container component — injects {@link ChatTheme} and binds controls to the
 * live appearance settings. Every change is applied immediately (live token
 * updates) and persisted by the theme service. Colours default to the token
 * cascade; the "default" button clears the override so `tokens.css` wins.
 */
@Component({
  selector: 'rv-appearance-tab',
  templateUrl: './appearance-tab.html',
  styleUrl: './appearance-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearanceTabComponent {
  protected readonly theme = inject(ChatTheme);
  private readonly document = inject(DOCUMENT);

  protected readonly fontScaleMin = FONT_SCALE_MIN;
  protected readonly fontScaleMax = FONT_SCALE_MAX;
  protected readonly fontScaleStep = FONT_SCALE_STEP;
  protected readonly chatWidthMin = CHAT_WIDTH_MIN;
  protected readonly chatWidthMax = CHAT_WIDTH_MAX;
  protected readonly chatWidthStep = CHAT_WIDTH_STEP;

  /** Full semantic colour palette rendered in the tab (task #3691). */
  protected readonly colorFields = APPEARANCE_COLOR_FIELDS;
  /** Named base themes (task #3691). */
  protected readonly themes = APPEARANCE_THEMES;
  /** App/prose font stacks. */
  protected readonly fontFamilies = APPEARANCE_FONT_FAMILIES;
  /** Message row spacing choices. */
  protected readonly messageSpacingOptions = APPEARANCE_MESSAGE_SPACING;

  /** Status line for the most recent import attempt (task #3691). */
  protected readonly importStatus = signal<string>('');

  protected setTheme(value: AppearanceThemeId): void {
    void this.theme.setTheme(value);
  }

  protected onSelectTheme(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.setTheme(target.value as AppearanceThemeId);
  }

  /** Export the current theme as JSON via a download-friendly textarea copy. */
  protected exportTheme(): string {
    return this.theme.exportTheme();
  }

  protected async onImport(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    const value = target.value.trim();
    if (value === '') {
      this.importStatus.set('');
      return;
    }
    const ok = await this.theme.importTheme(value);
    this.importStatus.set(ok ? 'Imported.' : 'Invalid theme JSON.');
  }

  protected setFontFamily(value: AppearanceFontFamily): void {
    void this.theme.update({ fontFamily: value });
  }

  protected setDensity(value: AppearanceDensity): void {
    void this.theme.update({ density: value });
  }

  protected setMessageSpacing(value: AppearanceMessageSpacing): void {
    void this.theme.update({ messageSpacing: value });
  }

  protected setTextRenderMode(value: TextRenderMode): void {
    void this.theme.update({ textRenderMode: value });
  }

  protected onScale(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const parsed = Number.parseFloat(target.value);
    if (Number.isNaN(parsed)) return;
    void this.theme.update({ fontScale: parsed });
  }

  protected onChatWidth(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const parsed = Number.parseFloat(target.value);
    if (Number.isNaN(parsed)) return;
    void this.theme.update({ chatWidthPercent: parsed });
  }

  protected toggleReducedMotion(event: Event): void {
    this.updateBoolean('reducedMotion', event);
  }

  protected toggleDisableShadows(event: Event): void {
    this.updateBoolean('disableShadows', event);
  }

  protected toggleShowTimestamps(event: Event): void {
    this.updateBoolean('showTimestamps', event);
  }

  protected toggleShowMessageIds(event: Event): void {
    this.updateBoolean('showMessageIds', event);
  }

  protected colorValue(field: keyof AppearanceColors): string {
    const override = this.theme.settings().colors[field];
    if (override !== undefined) return this.colorInputValue(override);
    const tokenValue = getComputedStyle(
      this.document.documentElement,
    ).getPropertyValue(COLOR_PREVIEW_TOKENS[field]);
    return this.colorInputValue(tokenValue);
  }

  protected isColorOverridden(field: keyof AppearanceColors): boolean {
    return this.theme.settings().colors[field] !== undefined;
  }

  protected onColor(field: keyof AppearanceColors, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const patch: MutableColors = {};
    patch[field] = target.value;
    void this.theme.update({ colors: patch });
  }

  protected clearColor(field: keyof AppearanceColors): void {
    const current = this.theme.settings().colors;
    const next: MutableColors = {};
    for (const f of this.colorFields) {
      if (f.key === field) continue;
      const v = current[f.key];
      if (v !== undefined) {
        next[f.key] = v;
      }
    }
    void this.theme.set({ ...this.theme.settings(), colors: next });
  }

  protected resetAll(): void {
    void this.theme.reset();
  }

  private updateBoolean(
    field:
      | 'reducedMotion'
      | 'disableShadows'
      | 'showTimestamps'
      | 'showMessageIds',
    event: Event,
  ): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    void this.theme.update({ [field]: target.checked });
  }

  private colorInputValue(value: string): string {
    const trimmed = value.trim();
    return /^#[\da-f]{6}$/i.test(trimmed) ? trimmed : '#000000';
  }
}
