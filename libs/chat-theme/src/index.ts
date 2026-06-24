import {
  type EnvironmentProviders,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';

import type { AppearanceSettings } from './lib/appearance-settings';
import { ChatTheme } from './lib/chat-theme';

export { ChatTheme } from './lib/chat-theme';
export {
  CHAT_SETTINGS_STORAGE,
  IndexedDbChatSettingsStorage,
  InMemoryChatSettingsStorage,
} from './lib/chat-settings-storage';
export type { ChatSettingsStorage } from './lib/chat-settings-storage';
export {
  type AppearanceSettings,
  type AppearanceColors,
  type AppearanceFontFamily,
  type AppearanceDensity,
  type TextRenderMode,
  DEFAULT_APPEARANCE,
  BASE_FONT_SIZES,
  BASE_DENSITY,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_STEP,
  clampFontScale,
  densityMultiplier,
} from './lib/appearance-settings';

/**
 * Extension token for overriding the *default* appearance that rusty-view
 * ships with. Downstream consumers (e.g. rusty-roleplay) provide a partial
 * {@link AppearanceSettings} here to bias the debug defaults toward their
 * house theme without reimplementing the application logic.
 *
 * The merged value is applied on top of {@link DEFAULT_APPEARANCE}; persisted
 * user preferences (from {@link CHAT_SETTINGS_STORAGE}) still win once loaded.
 */
export const CHAT_THEME = new InjectionToken<Partial<AppearanceSettings>>(
  'CHAT_THEME',
);

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
