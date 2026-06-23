import {
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { ChatTransport } from '@rusty-view/transport';
import {
  ChatStore,
  CHAT_STORAGE_ADAPTER,
  IndexedDbChatStorage,
} from '@rusty-view/chat-store';

/**
 * Configuration for the debug-chat app's transport connection to rusty-crew.
 */
export interface DebugChatConfig {
  /** Backend URL, e.g. http://192.168.1.10:9347 */
  readonly baseUrl: string;
  /** Optional bearer token (omit for no-auth LAN mode). */
  readonly bearerToken?: string;
}

/** Default config — points at the local rusty-crew service. */
const DEFAULT_CONFIG: DebugChatConfig = {
  baseUrl: 'http://127.0.0.1:9347',
};

/**
 * Provide all debug-chat DI wiring: ChatTransport (with config),
 * ChatStorageAdapter (IndexedDB), and ChatStore. Also triggers an initial
 * session list refresh + command registry load on startup.
 */
export function provideDebugChat(
  config: DebugChatConfig = DEFAULT_CONFIG,
): EnvironmentProviders {
  const transport = new ChatTransport({
    baseUrl: config.baseUrl,
    ...(config.bearerToken !== undefined
      ? { bearerToken: config.bearerToken }
      : {}),
  });

  return makeEnvironmentProviders([
    { provide: ChatTransport, useValue: transport },
    { provide: CHAT_STORAGE_ADAPTER, useClass: IndexedDbChatStorage },
    ChatStore,
    provideAppInitializer(() => {
      const store = inject(ChatStore);
      void store.refreshSessions();
      void store.loadCommands();
    }),
  ]);
}
