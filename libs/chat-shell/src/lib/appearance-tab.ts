import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import {
  type AppearanceColors,
  type AppearanceDensity,
  type AppearanceFontFamily,
  type TextRenderMode,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  ChatTheme,
} from '@rusty-view/chat-theme';

/** Mutable, optional colour map used while building update patches. */
type MutableColors = { -readonly [K in keyof AppearanceColors]?: string };

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

  protected readonly fontScaleMin = FONT_SCALE_MIN;
  protected readonly fontScaleMax = FONT_SCALE_MAX;
  protected readonly fontScaleStep = FONT_SCALE_STEP;

  /** Stable list of colour fields rendered in the tab. */
  protected readonly colorFields: ReadonlyArray<{
    readonly key: keyof AppearanceColors;
    readonly label: string;
  }> = [
    { key: 'bg', label: 'Background' },
    { key: 'surface', label: 'Surface / panels' },
    { key: 'surfaceRaised', label: 'Raised surface' },
    { key: 'border', label: 'Border' },
    { key: 'textPrimary', label: 'Text (primary)' },
    { key: 'textSecondary', label: 'Text (secondary)' },
    { key: 'accent', label: 'Accent / selection' },
  ];

  protected setFontFamily(value: AppearanceFontFamily): void {
    void this.theme.update({ fontFamily: value });
  }

  protected setDensity(value: AppearanceDensity): void {
    void this.theme.update({ density: value });
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

  protected colorValue(field: keyof AppearanceColors): string {
    return this.theme.settings().colors[field] ?? '#000000';
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
}
