/**
 * @rusty-view/chat-shell
 *
 * Debug app layout and container components: session list, transcript region,
 * event inspector, command composer, and the debug shell that assembles them.
 * The shell is the composition layer — it injects ChatStore and wires
 * transport events into the store + presentational components.
 *
 * Implemented in Den tasks #3185 (components + shell) and #3186 (debug MVP).
 */

export { DebugShellComponent } from './lib/debug-shell';
export { SessionListComponent } from './lib/session-list';
export { EventInspectorComponent } from './lib/event-inspector';
export { CommandComposerComponent } from './lib/command-composer';
export { TopMenuComponent } from './lib/top-menu';
export { OptionsPanelComponent } from './lib/options-panel';
export { AppearanceTabComponent } from './lib/appearance-tab';
export { HelpPanelComponent } from './lib/help-panel';
export { ProfilePanelComponent } from './lib/profile-panel';
export { SessionsPanelComponent } from './lib/sessions-panel';
export { AdminProfilesPanelComponent } from './lib/admin-profiles-panel';
export { AdminServicePanelComponent } from './lib/admin-service-panel';
export {
  CHAT_TOP_MENU_ITEMS,
  CHAT_OPTIONS_TABS,
  OPTIONS_PANEL_ID,
  HELP_PANEL_ID,
  PROFILES_PANEL_ID,
  SERVICE_PANEL_ID,
  SESSIONS_PANEL_ID,
} from './lib/shell-extension-tokens';
export type {
  ChatTopMenuItem,
  ChatOptionsTab,
} from './lib/shell-extension-tokens';
export {
  CHAT_AUTO_EXECUTE_HOOKS,
  CHAT_CONTENT_RENDERERS,
  CHAT_DATA_ACTIONS,
  CHAT_ENUM_PROVIDERS,
  CHAT_MESSAGE_TOOLBAR_ACTIONS,
  CHAT_PLUGINS,
  CHAT_SIDEBAR_PANELS,
  CHAT_SLASH_COMMANDS,
  provideChatPlugins,
} from './lib/plugin-api';
export type {
  ChatContentRenderer,
  ChatContentRenderContext,
  ChatMessageToolbarAction,
  ChatMessageToolbarContext,
  ChatPlugin,
  ChatPluginActionEffect,
  ChatPluginAutoExecuteHook,
  ChatPluginAutoTrigger,
  ChatPluginCommandArgument,
  ChatPluginCommandContext,
  ChatPluginCommandResult,
  ChatPluginConfirmationPolicy,
  ChatPluginDataAction,
  ChatPluginDataActionContext,
  ChatPluginDataActionResult,
  ChatPluginEnumProvider,
  ChatPluginEnumProviderContext,
  ChatPluginEvent,
  ChatPluginEventBus,
  ChatPluginPalette,
  ChatPluginSlashCommand,
  ChatSettingsPanel,
  ChatSidebarPanel,
} from './lib/plugin-api';

export const CHAT_SHELL_VERSION = '0.0.0' as const;
