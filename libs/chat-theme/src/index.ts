import {
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';

import type { AppearanceSettings } from './lib/appearance-settings';
import { ChatTheme } from './lib/chat-theme';
import { CHAT_THEME } from './lib/chat-theme-token';

export { ChatTheme } from './lib/chat-theme';
export { CHAT_THEME } from './lib/chat-theme-token';
export {
  CHAT_SETTINGS_STORAGE,
  IndexedDbChatSettingsStorage,
  InMemoryChatSettingsStorage,
} from './lib/chat-settings-storage';
export type { ChatSettingsStorage } from './lib/chat-settings-storage';
export {
  type AppearanceSettings,
  type AppearanceBackgroundPreset,
  type AppearanceColors,
  type AppearanceFontFamily,
  type AppearanceDensity,
  type AppearanceMessageSpacing,
  type AppearanceSyntaxTheme,
  type AppearanceThemeId,
  type TextRenderMode,
  APPEARANCE_BACKGROUND_PRESETS,
  APPEARANCE_COLOR_FIELDS,
  APPEARANCE_FONT_FAMILIES,
  APPEARANCE_MESSAGE_SPACING,
  APPEARANCE_SYNTAX_THEMES,
  APPEARANCE_THEMES,
  DEFAULT_APPEARANCE,
  BASE_FONT_SIZES,
  BASE_DENSITY,
  CHAT_WIDTH_MIN,
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_STEP,
  COMPOSER_HEIGHT_MIN,
  COMPOSER_HEIGHT_MAX,
  COMPOSER_HEIGHT_STEP,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_STEP,
  MESSAGE_SPACING_Y,
  clampChatWidthPercent,
  clampComposerHeightPx,
  clampFontScale,
  densityMultiplier,
  normalizeFontFamily,
  normalizeBackgroundPreset,
  normalizeMessageSpacing,
  normalizeSyntaxTheme,
  normalizeThemeId,
} from './lib/appearance-settings';

/**
 * Provide the {@link ChatTheme} service and force its construction on startup
 * (so persisted settings are loaded and applied to the DOM before first paint
 * settles). The caller is expected to provide {@link CHAT_SETTINGS_STORAGE}
 * (typically {@link IndexedDbChatSettingsStorage}); if absent, the theme runs
 * in-memory only.
 *
 * A {@link CHAT_THEME} default-override may be passed to bias the shipped
 * defaults.
 */
export function provideChatTheme(
  defaults?: Partial<AppearanceSettings>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: CHAT_THEME, useValue: defaults ?? {} },
    ChatTheme,
    provideAppInitializer(() => {
      inject(ChatTheme);
    }),
  ]);
}

export const CHAT_THEME_VERSION = '0.0.0' as const;
