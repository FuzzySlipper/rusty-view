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
export { TopMenuController } from './lib/top-menu-controller';
export { OptionsPanelComponent } from './lib/options-panel';
export { AppearanceTabComponent } from './lib/appearance-tab';
export { HotkeysTabComponent } from './lib/hotkeys-tab';
export {
  DEFAULT_HOTKEY_SETTINGS,
  HOTKEY_ACTIONS,
  HOTKEY_SETTINGS_STORAGE,
  HotkeySettingsService,
  IndexedDbHotkeySettingsStorage,
  normalizeHotkeySettings,
  type HotkeyAction,
  type HotkeySettings,
  type HotkeySettingsStorage,
} from './lib/hotkey-settings';
export { HelpPanelComponent } from './lib/help-panel';
export { DebugPanelComponent } from './lib/debug-panel';
export { ProfilePanelComponent } from './lib/profile-panel';
export { ExternalAgentPanelComponent } from './lib/external-agent-panel';
export { SessionsPanelComponent } from './lib/sessions-panel';
export { AdminProfilesPanelComponent } from './lib/admin-profiles-panel';
export { AdminProfileCreateComponent } from './lib/admin-profile-create';
export { AdminProfileEditComponent } from './lib/admin-profile-edit';
export { AdminToolProfileEditorComponent } from './lib/admin-tool-profile-editor';
export { AdminProvidersPanelComponent } from './lib/admin-providers-panel';
export { AdminServicePanelComponent } from './lib/admin-service-panel';
export {
  CHAT_TOP_MENU_ITEMS,
  CHAT_TOP_MENU_PANELS,
  CHAT_TOP_MENU_CONFIGURATION,
  CHAT_DEBUG_TAB_CONTEXT,
  CHAT_DEBUG_TABS,
  CHAT_OPTIONS_TABS,
  OPTIONS_PANEL_ID,
  HELP_PANEL_ID,
  DEBUG_PANEL_ID,
  PROFILES_PANEL_ID,
  PROVIDERS_PANEL_ID,
  SERVICE_PANEL_ID,
  SESSIONS_PANEL_ID,
} from './lib/shell-extension-tokens';
export type {
  ChatTopMenuItem,
  ChatTopMenuPanel,
  ChatTopMenuPanelWidth,
  ChatTopMenuConfiguration,
  ChatBuiltInTopMenuId,
  ChatDebugTab,
  ChatDebugTabContext,
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
export {
  coerceSlashCommandArguments,
  commandsForPalette,
  completeSlashCommand,
  executeSlashCommand,
  findSlashCommand,
  normalizeSlashCommandText,
  parseSlashCommand,
  pluginCommandArgsSchema,
  pluginCommandDescriptor,
} from './lib/slash-commands/slash-command-runtime';
export type {
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
export type {
  ParsedSlashCommand,
  SlashCommandCompletion,
  SlashCommandCompletionContext,
  SlashCommandParseFailure,
  SlashCommandParseResult,
  TypedSlashCommandArguments,
} from './lib/slash-commands/slash-command-runtime';
export type {
  ChatContentRenderer,
  ChatContentRenderContext,
} from '@rusty-view/transcript-renderer';

export const CHAT_SHELL_VERSION = '0.0.0' as const;
