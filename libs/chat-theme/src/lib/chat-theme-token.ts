import { InjectionToken } from '@angular/core';

import type { AppearanceSettings } from './appearance-settings';

/**
 * Extension token for overriding the *default* appearance that rusty-view ships
 * with. Downstream consumers provide a partial {@link AppearanceSettings} here
 * to bias debug defaults toward their house theme without reimplementing the
 * application logic.
 *
 * The merged value is applied on top of shipped defaults; persisted user
 * preferences from CHAT_SETTINGS_STORAGE still win once loaded.
 */
export const CHAT_THEME = new InjectionToken<Partial<AppearanceSettings>>(
  'CHAT_THEME',
);
