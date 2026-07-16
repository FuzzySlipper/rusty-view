import { InjectionToken, type Type } from '@angular/core';

/**
 * Extension tokens for the chat shell's menu and options surfaces.
 *
 * These are the composition seams documented in `docs/rusty-view.md` (the
 * `CHAT_*` provider family). Downstream consumers provide additional/override
 * entries through these tokens without forking the base chat mechanics.
 * rusty-view ships boring debug defaults.
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
 *     need their own chrome (Options, Help). Built-in panel ids are rendered by
 *     the shell; downstream panel ids can be rendered by providing
 *     {@link CHAT_TOP_MENU_PANELS}.
 *
 * `order` controls render order (ascending; ties break by id). The shell
 * always reserves the ids `options` and `help` for its built-in panels.
 */
export interface ChatTopMenuItem {
  readonly id: string;
  readonly label: string;
  /** Optional short help text for the reusable `rvTooltip` topbar affordance. */
  readonly tooltip?: string;
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

export type ChatTopMenuPanelWidth = 'default' | 'wide';

/**
 * A top-menu overlay panel supplied by a downstream shell/plugin. The panel is
 * rendered with the same overlay, close button, and dismiss behavior as built-in
 * panels. Providing a panel also contributes a top-level menu item unless an
 * explicit {@link ChatTopMenuItem} with the same id overrides it; built-in panel
 * ids remain reserved and always win.
 */
export interface ChatTopMenuPanel {
  readonly id: string;
  /** Top-level menu label. Defaults to `title`. */
  readonly label?: string;
  /** Dialog title shown in the top-menu panel chrome. */
  readonly title: string;
  readonly order?: number;
  readonly width?: ChatTopMenuPanelWidth;
  readonly component: Type<unknown>;
}

/**
 * DI token providing downstream-owned top-menu overlay panels. The shell turns
 * each panel into a menu item and renders the component via NgComponentOutlet
 * when that item opens.
 */
export const CHAT_TOP_MENU_PANELS = new InjectionToken<
  readonly ChatTopMenuPanel[]
>('CHAT_TOP_MENU_PANELS');

/** Built-in panel ids reserved by the shell and stable for configuration. */
export const PROFILES_PANEL_ID = 'profiles' as const;
export const SERVICE_PANEL_ID = 'service' as const;
export const DEBUG_PANEL_ID = 'debug' as const;
export const OPTIONS_PANEL_ID = 'options' as const;
export const HELP_PANEL_ID = 'help' as const;
export const SESSIONS_PANEL_ID = 'sessions' as const;
export const PROVIDERS_PANEL_ID = 'providers' as const;

export type ChatBuiltInTopMenuId =
  | typeof PROFILES_PANEL_ID
  | typeof SERVICE_PANEL_ID
  | typeof DEBUG_PANEL_ID
  | typeof OPTIONS_PANEL_ID
  | typeof HELP_PANEL_ID
  | typeof SESSIONS_PANEL_ID
  | typeof PROVIDERS_PANEL_ID;

/**
 * Configuration for the shell-owned top-menu entries. Hiding an entry removes
 * only its top-bar affordance; the built-in id remains reserved and its panel
 * can still be opened through {@link TopMenuController}.
 */
export interface ChatTopMenuConfiguration {
  readonly hiddenBuiltInItemIds?: readonly ChatBuiltInTopMenuId[];
}

/** Single-provider downstream configuration for shell-owned top-menu items. */
export const CHAT_TOP_MENU_CONFIGURATION =
  new InjectionToken<ChatTopMenuConfiguration>('CHAT_TOP_MENU_CONFIGURATION');

/** A downstream tab rendered inside the built-in Debug panel. */
export interface ChatDebugTab {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  readonly component: Type<unknown>;
}

/**
 * Multi-provider Debug tab contributions. The built-in ids `providers`,
 * `tools`, and `storage` are reserved and cannot be replaced.
 */
export const CHAT_DEBUG_TABS = new InjectionToken<readonly ChatDebugTab[]>(
  'CHAT_DEBUG_TABS',
);

/**
 * A tab in the Options panel. `component` is a standalone component rendered
 * inside the panel body when the tab is active. Downstream tabs are added by
 * providing additional entries here.
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
