import { InjectionToken, type Type } from '@angular/core';

/**
 * Extension tokens for the chat shell's menu and options surfaces.
 *
 * These are the composition seams documented in `docs/rusty-view.md` (the
 * `CHAT_*` provider family). Downstream consumers — notably rusty-roleplay —
 * provide additional/override entries through these tokens without forking the
 * base chat mechanics. rusty-view ships boring debug defaults.
 *
 * Tokens live in chat-shell (where the surfaces are rendered) so both the
 * default wiring and downstream providers import from a single public barrel.
 */

/**
 * A top-level menu entry. `kind` tells the shell how to handle a selection:
 *
 *   - `action`: invoke {@link onActivate} and close any open panel. Use for
 *     one-shot actions (e.g. "Reconnect").
 *   - `panel`: open {@link panelId} as a modal panel. Use for surfaces that
 *     need their own chrome (Options, Help).
 *
 * `order` controls render order (ascending; ties break by id). The shell
 * always reserves the ids `options` and `help` for its built-in panels.
 */
export interface ChatTopMenuItem {
  readonly id: string;
  readonly label: string;
  readonly kind: 'action' | 'panel';
  readonly panelId?: string;
  readonly order?: number;
  readonly onActivate?: () => void;
}

/**
 * DI token providing the set of top-level menu items. Multi-provider: the shell
 * flattens all provided arrays, dedupes by id (built-ins win for reserved ids),
 * and sorts by `order`. Defaults: `File`/`Options`/`Help` debug entries.
 */
export const CHAT_TOP_MENU_ITEMS = new InjectionToken<
  readonly ChatTopMenuItem[]
>('CHAT_TOP_MENU_ITEMS');

/**
 * A tab in the Options panel. `component` is a standalone component rendered
 * inside the panel body when the tab is active. Downstream tabs (e.g. a
 * roleplay theme tab) are added by providing additional entries here.
 */
export interface ChatOptionsTab {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  readonly component: Type<unknown>;
}

/**
 * DI token providing the set of Options panel tabs. Multi-provider. The shell
 * always includes the built-in `appearance` tab; downstream consumers may add
 * more and re-order via `order`.
 */
export const CHAT_OPTIONS_TABS = new InjectionToken<readonly ChatOptionsTab[]>(
  'CHAT_OPTIONS_TABS',
);

/** Built-in panel ids reserved by the shell. */
export const PROFILES_PANEL_ID = 'profiles' as const;
export const SERVICE_PANEL_ID = 'service' as const;
export const OPTIONS_PANEL_ID = 'options' as const;
export const HELP_PANEL_ID = 'help' as const;
export const SESSIONS_PANEL_ID = 'sessions' as const;
export const PROVIDERS_PANEL_ID = 'providers' as const;
