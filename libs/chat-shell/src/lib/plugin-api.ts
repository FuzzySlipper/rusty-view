import {
  InjectionToken,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import type { ChatMessage } from '@rusty-view/chat-domain';
import {
  CHAT_CONTENT_RENDERERS,
  type ChatContentRenderer,
} from '@rusty-view/transcript-renderer';

import {
  CHAT_OPTIONS_TABS,
  CHAT_TOP_MENU_ITEMS,
  type ChatOptionsTab,
  type ChatTopMenuItem,
} from './shell-extension-tokens';

export { CHAT_CONTENT_RENDERERS } from '@rusty-view/transcript-renderer';
export type {
  ChatContentRenderer,
  ChatContentRenderContext,
} from '@rusty-view/transcript-renderer';

export type ChatPluginActionEffect =
  | 'none'
  | 'read'
  | 'write'
  | 'destructive'
  | 'external';

export type ChatPluginPalette = 'chat-input' | 'global' | 'message-context';

export type ChatPluginAutoTrigger =
  | 'onAppStart'
  | 'onSessionOpen'
  | 'onUserMessage'
  | 'onMessageReceived'
  | 'onRunComplete'
  | 'onToolCompleted';

export interface ChatPluginConfirmationPolicy {
  readonly required: boolean;
  readonly title?: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

export interface ChatPluginCommandArgument {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'file';
  readonly description?: string;
  readonly optional?: boolean;
  readonly defaultValue?: unknown;
  readonly enumValues?: readonly string[];
  readonly enumProviderId?: string;
}

export interface ChatPluginCommandContext {
  readonly sessionId: string | undefined;
  readonly messageId: string | undefined;
  readonly selectedText: string | undefined;
  readonly piped: unknown;
  readonly signal: AbortSignal | undefined;
  confirm(policy: ChatPluginConfirmationPolicy): Promise<boolean>;
}

export type ChatPluginCommandResult =
  | { readonly type: 'silent' }
  | {
      readonly type: 'message';
      readonly content: string;
      readonly role?: 'system' | 'user';
    }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'value'; readonly value: unknown }
  | { readonly type: 'abort' };

export interface ChatPluginSlashCommand {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly category?: string;
  readonly icon?: string;
  readonly arguments?: readonly ChatPluginCommandArgument[];
  readonly namedArguments?: Readonly<Record<string, ChatPluginCommandArgument>>;
  readonly palettes?: readonly ChatPluginPalette[];
  readonly sideEffect?: ChatPluginActionEffect;
  readonly confirmation?: ChatPluginConfirmationPolicy;
  run(
    args: readonly unknown[],
    named: Readonly<Record<string, unknown>>,
    context: ChatPluginCommandContext,
  ): Promise<ChatPluginCommandResult>;
}

export interface ChatPluginEnumProviderContext {
  readonly sessionId: string | undefined;
  readonly commandName: string | undefined;
  readonly argumentName: string | undefined;
}

export interface ChatPluginEnumProvider {
  readonly id: string;
  readonly label?: string;
  values(
    query: string,
    context: ChatPluginEnumProviderContext,
  ): readonly string[] | Promise<readonly string[]>;
}

export interface ChatPluginAutoExecuteHook {
  readonly id: string;
  readonly trigger: ChatPluginAutoTrigger;
  readonly command: string;
  readonly throttleMs?: number;
}

export interface ChatMessageToolbarContext {
  readonly message: ChatMessage;
  readonly sessionId: string | undefined;
}

export interface ChatMessageToolbarAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly order?: number;
  readonly sideEffect?: ChatPluginActionEffect;
  readonly confirmation?: ChatPluginConfirmationPolicy;
  readonly component?: Type<unknown>;
  canShow?(context: ChatMessageToolbarContext): boolean;
  run?(context: ChatMessageToolbarContext): Promise<void>;
}

export interface ChatSidebarPanel {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  readonly component: Type<unknown>;
}

export type ChatSettingsPanel = ChatOptionsTab;

export interface ChatPluginDataActionContext {
  readonly sessionId: string | undefined;
  readonly conversationId: string | undefined;
  readonly messageId: string | undefined;
  readonly input: unknown;
  readonly signal: AbortSignal | undefined;
  confirm(policy: ChatPluginConfirmationPolicy): Promise<boolean>;
}

export type ChatPluginDataActionResult =
  | {
      readonly status: 'completed';
      readonly summary: string;
      readonly data?: unknown;
    }
  | { readonly status: 'cancelled'; readonly summary: string }
  | {
      readonly status: 'failed';
      readonly summary: string;
      readonly error?: unknown;
    };

export interface ChatPluginDataAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scope:
    | 'settings'
    | 'conversation'
    | 'message'
    | 'attachment'
    | 'plugin'
    | 'external';
  readonly sideEffect: ChatPluginActionEffect;
  readonly confirmation?: ChatPluginConfirmationPolicy;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  run(
    context: ChatPluginDataActionContext,
  ): Promise<ChatPluginDataActionResult>;
}

export interface ChatPluginEvent {
  readonly type: string;
  readonly payload: unknown;
}

export interface ChatPluginEventBus {
  subscribe(
    type: string,
    handler: (event: ChatPluginEvent) => void,
  ): () => void;
  emit(event: ChatPluginEvent): void;
}

export interface ChatPlugin {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly providers?: readonly Provider[];
  readonly topMenuItems?: readonly ChatTopMenuItem[];
  readonly settingsPanels?: readonly ChatSettingsPanel[];
  readonly contentRenderers?: readonly ChatContentRenderer[];
  readonly slashCommands?: readonly ChatPluginSlashCommand[];
  readonly enumProviders?: readonly ChatPluginEnumProvider[];
  readonly autoExecuteHooks?: readonly ChatPluginAutoExecuteHook[];
  readonly messageToolbarActions?: readonly ChatMessageToolbarAction[];
  readonly sidebarPanels?: readonly ChatSidebarPanel[];
  readonly dataActions?: readonly ChatPluginDataAction[];
  subscribe?(events: ChatPluginEventBus): void;
}

export const CHAT_PLUGINS = new InjectionToken<readonly ChatPlugin[]>(
  'CHAT_PLUGINS',
);

export const CHAT_SLASH_COMMANDS = new InjectionToken<
  readonly ChatPluginSlashCommand[]
>('CHAT_SLASH_COMMANDS');

export const CHAT_ENUM_PROVIDERS = new InjectionToken<
  readonly ChatPluginEnumProvider[]
>('CHAT_ENUM_PROVIDERS');

export const CHAT_AUTO_EXECUTE_HOOKS = new InjectionToken<
  readonly ChatPluginAutoExecuteHook[]
>('CHAT_AUTO_EXECUTE_HOOKS');

export const CHAT_MESSAGE_TOOLBAR_ACTIONS = new InjectionToken<
  readonly ChatMessageToolbarAction[]
>('CHAT_MESSAGE_TOOLBAR_ACTIONS');

export const CHAT_SIDEBAR_PANELS = new InjectionToken<
  readonly ChatSidebarPanel[]
>('CHAT_SIDEBAR_PANELS');

export const CHAT_DATA_ACTIONS = new InjectionToken<
  readonly ChatPluginDataAction[]
>('CHAT_DATA_ACTIONS');

export function provideChatPlugins(
  ...plugins: readonly ChatPlugin[]
): EnvironmentProviders {
  const providers: Provider[] = [];
  const topMenuItems = flatMapPluginValues(plugins, (p) => p.topMenuItems);
  const settingsPanels = flatMapPluginValues(plugins, (p) => p.settingsPanels);
  const contentRenderers = flatMapPluginValues(
    plugins,
    (p) => p.contentRenderers,
  );
  const slashCommands = flatMapPluginValues(plugins, (p) => p.slashCommands);
  const enumProviders = flatMapPluginValues(plugins, (p) => p.enumProviders);
  const autoExecuteHooks = flatMapPluginValues(
    plugins,
    (p) => p.autoExecuteHooks,
  );
  const messageToolbarActions = flatMapPluginValues(
    plugins,
    (p) => p.messageToolbarActions,
  );
  const sidebarPanels = flatMapPluginValues(plugins, (p) => p.sidebarPanels);
  const dataActions = flatMapPluginValues(plugins, (p) => p.dataActions);

  for (const plugin of plugins) {
    if (plugin.providers !== undefined) {
      providers.push(...plugin.providers);
    }
  }

  providers.push({ provide: CHAT_PLUGINS, useValue: plugins });
  provideIfNonEmpty(providers, CHAT_TOP_MENU_ITEMS, topMenuItems);
  provideIfNonEmpty(providers, CHAT_OPTIONS_TABS, settingsPanels);
  provideIfNonEmpty(providers, CHAT_CONTENT_RENDERERS, contentRenderers);
  provideIfNonEmpty(providers, CHAT_SLASH_COMMANDS, slashCommands);
  provideIfNonEmpty(providers, CHAT_ENUM_PROVIDERS, enumProviders);
  provideIfNonEmpty(providers, CHAT_AUTO_EXECUTE_HOOKS, autoExecuteHooks);
  provideIfNonEmpty(
    providers,
    CHAT_MESSAGE_TOOLBAR_ACTIONS,
    messageToolbarActions,
  );
  provideIfNonEmpty(providers, CHAT_SIDEBAR_PANELS, sidebarPanels);
  provideIfNonEmpty(providers, CHAT_DATA_ACTIONS, dataActions);

  return makeEnvironmentProviders(providers);
}

function flatMapPluginValues<T>(
  plugins: readonly ChatPlugin[],
  select: (plugin: ChatPlugin) => readonly T[] | undefined,
): readonly T[] {
  return plugins.flatMap((plugin) => [...(select(plugin) ?? [])]);
}

function provideIfNonEmpty<T>(
  providers: Provider[],
  token: InjectionToken<readonly T[]>,
  values: readonly T[],
): void {
  if (values.length === 0) return;
  providers.push({ provide: token, useValue: values });
}
