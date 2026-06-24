import {
  computed,
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
import {
  ChatTheme,
  CHAT_SETTINGS_STORAGE,
  IndexedDbChatSettingsStorage,
  provideChatTheme,
} from '@rusty-view/chat-theme';
import { TRANSCRIPT_TEXT_RENDER_MODE } from '@rusty-view/transcript-renderer';

/**
 * Configuration for the debug-chat app's transport connection to rusty-crew.
 */
export interface DebugChatConfig {
  /** Backend URL, e.g. http://192.168.1.10:9347 */
  readonly baseUrl: string;
  /** Optional bearer token (omit for no-auth LAN mode). */
  readonly bearerToken?: string;
}

/** Default rusty-crew HTTP port, used when deriving the URL from the page host. */
const DEFAULT_API_PORT = 9347;

/**
 * Optional deploy-time config injected on `window` (e.g. via a `<script>` in
 * index.html or a config.js). Lets a deployment pin the backend without a
 * rebuild.
 */
interface RustyViewWindowConfig {
  readonly baseUrl?: string;
  readonly bearerToken?: string;
}

declare global {
  interface Window {
    __RUSTY_VIEW_CONFIG__?: RustyViewWindowConfig;
  }
}

/**
 * Resolve the rusty-crew backend config at runtime, so a single build works
 * from any host. Resolution order (first match wins):
 *
 *   1. `?api=<url>` query param — explicit, ephemeral; handy for testing.
 *   2. `window.__RUSTY_VIEW_CONFIG__.baseUrl` — injected at deploy time.
 *   3. Same host that served the page, on the default API port — e.g. the view
 *      loaded from `http://den-k8:4321` talks to `http://den-k8:9347`.
 *
 * The previous hardcoded `http://127.0.0.1:9347` only worked when the browser
 * ran on the same machine as rusty-crew; any LAN/remote user (the normal case —
 * browser on a workstation, rusty-crew on a headless box) got "No sessions"
 * because `127.0.0.1` resolved to their own device.
 */
export function resolveDebugChatConfig(): DebugChatConfig {
  const windowConfig = window.__RUSTY_VIEW_CONFIG__;
  const queryBaseUrl = new URLSearchParams(window.location.search)
    .get('api')
    ?.trim();

  const baseUrl =
    (queryBaseUrl !== undefined && queryBaseUrl !== '' ? queryBaseUrl : undefined) ??
    windowConfig?.baseUrl ??
    deriveBaseUrlFromLocation();

  return {
    baseUrl,
    ...(windowConfig?.bearerToken !== undefined
      ? { bearerToken: windowConfig.bearerToken }
      : {}),
  };
}

/** Derive `http(s)://<page-host>:<api-port>` from the serving origin. */
function deriveBaseUrlFromLocation(): string {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
}

/**
 * Provide all debug-chat DI wiring: ChatTransport (with config),
 * ChatStorageAdapter (IndexedDB), and ChatStore. Also triggers an initial
 * session list refresh + command registry load on startup.
 *
 * Called with no argument, the backend config is resolved at runtime via
 * {@link resolveDebugChatConfig}. Tests and embedders may pass an explicit config.
 */
export function provideDebugChat(
  config: DebugChatConfig = resolveDebugChatConfig(),
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
    { provide: CHAT_SETTINGS_STORAGE, useClass: IndexedDbChatSettingsStorage },
    IndexedDbChatSettingsStorage,
    provideChatTheme(),
    {
      provide: TRANSCRIPT_TEXT_RENDER_MODE,
      useFactory: (theme: ChatTheme) =>
        computed(() => theme.settings().textRenderMode),
      deps: [ChatTheme],
    },
    ChatStore,
    provideAppInitializer(() => {
      const store = inject(ChatStore);
      void store.refreshSessions();
      void store.loadCommands();
    }),
  ]);
}
