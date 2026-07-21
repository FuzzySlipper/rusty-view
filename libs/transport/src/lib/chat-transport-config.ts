/** Minimal `fetch` type alias — matches the global fetch signature. */
export type FetchImpl = typeof fetch;

/**
 * Configuration for a {@link ChatTransport} instance. No hardcoded host/port —
 * every value comes from the caller (app config, env, etc.).
 *
 * `bearerToken` is absent in no-auth LAN/dev mode
 * (`RUSTY_CREW_ADMIN_AUTH_MODE=none`). When present, transport adds
 * `Authorization: Bearer <token>` to all requests. Transport never persists the
 * token (the store/IndexedDB layer has no access to config).
 */
export interface ChatTransportConfig {
  readonly baseUrl: string;
  /**
   * Role-bound coordination surface for this service origin. This is deploy
   * configuration, never an operator-facing switch. Callers that target a
   * debug service must set it explicitly; omission safely defaults to
   * production.
   */
  readonly coordinationRole?: 'production' | 'debug';
  readonly bearerToken?: string;
  readonly timeoutMs: number;
  /**
   * Timeout for agent-waking write requests (send-message, send-command), in ms.
   *
   * These POSTs block until the backend finishes the turn (model + tool calls),
   * which routinely outlasts the read {@link timeoutMs}. Applying the 15s read
   * timeout to them aborts the request mid-turn ("canceled" in devtools), which
   * skips the post-write transcript catch-up and freezes the UI until a manual
   * refresh. A generous cap avoids false cancellation while still releasing a
   * genuinely hung socket. `0` disables the write timeout entirely.
   */
  readonly writeTimeoutMs: number;
  readonly reconnectInitialMs: number;
  readonly reconnectMaxMs: number;
  readonly reconnectMaxAttempts: number;
  /** Override fetch (testing). Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: FetchImpl;
}

/**
 * Input for {@link resolveChatTransportConfig}. Required fields are explicit;
 * optional fields fall back to documented defaults.
 */
export type ChatTransportConfigInput = Pick<ChatTransportConfig, 'baseUrl'> &
  Partial<Omit<ChatTransportConfig, 'baseUrl'>>;

const DEFAULT_TIMEOUT_MS = 15_000;
// Ten minutes: long enough that a normal agent turn (model + tools) never gets
// falsely aborted, short enough that a dead socket eventually releases the
// pending-send UI state instead of hanging forever.
const DEFAULT_WRITE_TIMEOUT_MS = 600_000;
const DEFAULT_RECONNECT_INITIAL_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 10;

const MAX_BEARER_TOKEN_LENGTH = 4_096;

/**
 * Resolve a full config from partial input, filling defaults and validating.
 * Throws {@link ChatTransportError} (code `config_error`) on invalid input.
 *
 * Optional fields are assigned conditionally to satisfy exactOptionalPropertyTypes.
 */
export function resolveChatTransportConfig(
  input: ChatTransportConfigInput,
): ChatTransportConfig {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const bearerToken =
    input.bearerToken !== undefined
      ? validateBearerToken(input.bearerToken)
      : undefined;

  const config: ChatTransportConfig = {
    baseUrl,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    writeTimeoutMs: input.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
    reconnectInitialMs:
      input.reconnectInitialMs ?? DEFAULT_RECONNECT_INITIAL_MS,
    reconnectMaxMs: input.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
    reconnectMaxAttempts:
      input.reconnectMaxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS,
    // Conditional spread: only include optional fields when they have values,
    // to satisfy exactOptionalPropertyTypes (never assign explicit undefined).
    ...(bearerToken !== undefined ? { bearerToken } : {}),
    ...(input.coordinationRole !== undefined
      ? { coordinationRole: input.coordinationRole }
      : {}),
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
  };

  validateConfig(config);
  return config;
}

function validateBearerToken(raw: string): string {
  const token = raw.trim();
  if (token.length === 0) {
    throw new ChatTransportConfigError(
      'bearerToken must not be empty or whitespace-only',
    );
  }
  if (token.length > MAX_BEARER_TOKEN_LENGTH) {
    throw new ChatTransportConfigError(
      `bearerToken exceeds maximum length of ${MAX_BEARER_TOKEN_LENGTH}`,
    );
  }
  return token;
}

function validateConfig(config: ChatTransportConfig): void {
  if (config.timeoutMs < 1) {
    throw new ChatTransportConfigError('timeoutMs must be >= 1');
  }
  if (config.writeTimeoutMs < 0) {
    throw new ChatTransportConfigError('writeTimeoutMs must be >= 0');
  }
  if (config.reconnectInitialMs < 0) {
    throw new ChatTransportConfigError('reconnectInitialMs must be >= 0');
  }
  if (config.reconnectMaxMs < config.reconnectInitialMs) {
    throw new ChatTransportConfigError(
      'reconnectMaxMs must be >= reconnectInitialMs',
    );
  }
  if (config.reconnectMaxAttempts < 1) {
    throw new ChatTransportConfigError('reconnectMaxAttempts must be >= 1');
  }
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ChatTransportConfigError('baseUrl must not be empty');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ChatTransportConfigError(
      `baseUrl is not a valid URL: ${trimmed}`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ChatTransportConfigError(
      `baseUrl protocol must be http or https, got: ${url.protocol}`,
    );
  }
  // Strip trailing slash so path concatenation is clean.
  return trimmed.replace(/\/+$/, '');
}

class ChatTransportConfigError extends Error {
  readonly code = 'config_error' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ChatTransportConfigError';
  }
}
