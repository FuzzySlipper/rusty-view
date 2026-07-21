import {
  computed,
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { ChatTransport } from '@rusty-view/transport';
import {
  AdminStore,
  ChatStore,
  ExternalAgentStore,
  SwitchboardStore,
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
import {
  HOTKEY_SETTINGS_STORAGE,
  IndexedDbHotkeySettingsStorage,
} from '@rusty-view/chat-shell';

/**
 * Configuration for the rusty-view app's transport connection to rusty-crew.
 */
export interface RustyViewConfig {
  /** Backend URL, e.g. http://192.168.1.10:9347 */
  readonly baseUrl: string;
  /** Optional bearer token (omit for no-auth LAN mode). */
  readonly bearerToken?: string;
  /** Fixed service coordination role; this is deploy config, not a UI toggle. */
  readonly coordinationRole?: 'production' | 'debug';
}

/** Default rusty-crew HTTP port used by the recognized split dev topology. */
const DEFAULT_API_PORT = 9347;
const SPLIT_DEV_SERVER_PORTS = new Set(['4200', '4210']);

/**
 * Optional deploy-time config injected on `window` (e.g. via a `<script>` in
 * index.html or a config.js). Lets a deployment pin the backend without a
 * rebuild.
 */
export interface RustyViewWindowConfig {
  readonly baseUrl?: string;
  readonly bearerToken?: string;
  readonly coordinationRole?: 'production' | 'debug';
}

export interface RustyViewRuntimeWindow {
  readonly location: Pick<
    Location,
    'origin' | 'port' | 'protocol' | 'hostname' | 'search'
  >;
  readonly __RUSTY_VIEW_CONFIG__?: RustyViewWindowConfig;
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
 *   3. The serving origin for normal deployments, including standard HTTP/TLS
 *      reverse proxies and direct rusty-crew ports (`9347` live or `9348`
 *      debug/test).
 *   4. The serving host on `9347` only for this repo's recognized HTTP dev
 *      server ports (`4200` and `4210`).
 *
 * The previous hardcoded `http://127.0.0.1:9347` only worked when the browser
 * ran on the same machine as rusty-crew; any LAN/remote user (the normal case —
 * browser on a workstation, rusty-crew on a headless box) got "No sessions"
 * because `127.0.0.1` resolved to their own device.
 */
export function resolveRustyViewConfig(
  runtimeWindow: RustyViewRuntimeWindow = window,
): RustyViewConfig {
  const windowConfig = runtimeWindow.__RUSTY_VIEW_CONFIG__;
  const queryBaseUrl = new URLSearchParams(runtimeWindow.location.search)
    .get('api')
    ?.trim();

  const baseUrl =
    (queryBaseUrl !== undefined && queryBaseUrl !== ''
      ? queryBaseUrl
      : undefined) ??
    windowConfig?.baseUrl ??
    deriveBaseUrlFromLocationParts(runtimeWindow.location);

  return {
    baseUrl,
    ...(windowConfig?.bearerToken !== undefined
      ? { bearerToken: windowConfig.bearerToken }
      : {}),
    ...(windowConfig?.coordinationRole !== undefined
      ? { coordinationRole: windowConfig.coordinationRole }
      : new URL(baseUrl).port === '9348'
        ? { coordinationRole: 'debug' as const }
        : {}),
  };
}

export function deriveBaseUrlFromLocationParts(
  location: Pick<Location, 'origin' | 'port' | 'protocol' | 'hostname'>,
): string {
  const { origin, port, protocol, hostname } = location;
  if (protocol === 'http:' && SPLIT_DEV_SERVER_PORTS.has(port)) {
    return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
  }
  return origin;
}

/**
 * Provide all rusty-view DI wiring: ChatTransport (with config),
 * ChatStorageAdapter (IndexedDB), and ChatStore. Also triggers an initial
 * session list refresh + command registry load on startup.
 *
 * Called with no argument, the backend config is resolved at runtime via
 * {@link resolveRustyViewConfig}. Tests and embedders may pass an explicit config.
 */
export function provideRustyView(
  config: RustyViewConfig = resolveRustyViewConfig(),
): EnvironmentProviders {
  const transport = new ChatTransport({
    baseUrl: config.baseUrl,
    ...(config.bearerToken !== undefined
      ? { bearerToken: config.bearerToken }
      : {}),
    ...(config.coordinationRole !== undefined
      ? { coordinationRole: config.coordinationRole }
      : {}),
  });

  return makeEnvironmentProviders([
    { provide: ChatTransport, useValue: transport },
    { provide: CHAT_STORAGE_ADAPTER, useClass: IndexedDbChatStorage },
    { provide: CHAT_SETTINGS_STORAGE, useClass: IndexedDbChatSettingsStorage },
    {
      provide: HOTKEY_SETTINGS_STORAGE,
      useClass: IndexedDbHotkeySettingsStorage,
    },
    IndexedDbChatSettingsStorage,
    provideChatTheme(),
    {
      provide: TRANSCRIPT_TEXT_RENDER_MODE,
      useFactory: (theme: ChatTheme) =>
        computed(() => theme.settings().textRenderMode),
      deps: [ChatTheme],
    },
    ChatStore,
    ExternalAgentStore,
    SwitchboardStore,
    AdminStore,
    provideAppInitializer(() => {
      const store = inject(ChatStore);
      void store.refreshSessions();
      void store.loadCommands();
    }),
  ]);
}
