import type {
  ApiEnvelope,
  ApiError,
  ChatCommandRegistry,
  ChatEvent,
  ChatSessionOpenResult,
  ChatSessionPage,
  ChatSessionStatus,
  ExecuteChatCommandRequest,
  ExecuteChatCommandResult,
  ExecuteChatCommandResponse,
  ListChatCommandsResponse,
  ListChatSessionsResponse,
  OpenChatSessionResponse,
  ReplayChatSessionEventsResponse,
  SendChatMessageRequest,
  SendChatMessageResponse,
  SendChatMessageResult,
} from '@rusty-view/protocol';

import {
  HEADER_NAMES,
  SESSIONS_PATH,
  SESSION_PATH,
  SESSION_EVENTS_PATH,
  SESSION_MESSAGES_PATH,
  COMMANDS_PATH,
  SESSION_COMMANDS_PATH,
} from './chat-routes';
import { ChatTransportError, classifyFetchError } from './chat-transport-error';
import type { ChatTransportErrorInit } from './chat-transport-error';
import type { ChatTransportConfig } from './chat-transport-config';
import type { FetchImpl } from './chat-transport-config';

/** Query parameters for listing sessions (snake_case matches the wire format). */
export type ListSessionsQuery = {
  readonly limit?: number;
  readonly offset?: number;
  readonly profile_id?: string;
  readonly status?: ChatSessionStatus;
};

/** Query parameters for opening a session (snake_case matches the wire format). */
export type OpenSessionQuery = {
  readonly limit?: number;
  readonly before?: string;
  readonly include_tool_payloads?: boolean;
};

/** Query parameters for replaying events (snake_case matches the wire format). */
export type ReplayEventsQuery = {
  readonly cursor?: string;
  readonly limit?: number;
};

interface RequestOptions {
  pathParams?: Record<string, string>;
  query?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  body?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * HTTP client for the Rusty Crew chat session API.
 *
 * Owns all fetch-based communication (session list/open, event replay,
 * send-message, command registry/execute). Framework-neutral — no Angular.
 * The SSE stream is handled separately by {@link ChatEventStream}; this class
 * only does request/response HTTP.
 *
 * Auth: adds `Authorization: Bearer <token>` when the config carries a
 * bearerToken; omits it entirely in no-auth LAN/dev mode. Never persists tokens.
 */
export class ChatHttpTransport {
  private readonly config: ChatTransportConfig;
  private readonly fetchImpl: FetchImpl;

  constructor(config: ChatTransportConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  /** List chat-capable sessions with optional filtering/pagination. */
  async listSessions(query?: ListSessionsQuery): Promise<ChatSessionPage> {
    const body = await this.requestJson<ListChatSessionsResponse>(
      'GET',
      SESSIONS_PATH,
      { ...(query !== undefined ? { query } : {}) },
    );
    return unwrapEnvelope(body);
  }

  /** Open a session and get the initial transcript page + latest cursor. */
  async openSession(
    sessionId: string,
    query?: OpenSessionQuery,
  ): Promise<ChatSessionOpenResult> {
    const body = await this.requestJson<OpenChatSessionResponse>(
      'GET',
      SESSION_PATH,
      {
        pathParams: { session_id: sessionId },
        ...(query !== undefined ? { query } : {}),
      },
    );
    return unwrapEnvelope(body);
  }

  /** Replay historical events after a cursor. */
  async replayEvents(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEvent[]> {
    const body = await this.requestJson<ReplayChatSessionEventsResponse>(
      'GET',
      SESSION_EVENTS_PATH,
      {
        pathParams: { session_id: sessionId },
        ...(query !== undefined ? { query } : {}),
      },
    );
    return unwrapEnvelope(body).items;
  }

  /** Append a user message and request an agent wake. */
  async sendMessage(
    sessionId: string,
    request: SendChatMessageRequest,
    idempotencyKey?: string,
  ): Promise<SendChatMessageResult> {
    const options: RequestOptions = {
      pathParams: { session_id: sessionId },
      body: request,
    };
    if (idempotencyKey !== undefined) {
      options.extraHeaders = { [HEADER_NAMES.idempotencyKey]: idempotencyKey };
    }
    const body = await this.requestJson<SendChatMessageResponse>(
      'POST',
      SESSION_MESSAGES_PATH,
      options,
    );
    return unwrapEnvelope(body);
  }

  /** List the chat command registry (slash/debug commands). */
  async listCommands(): Promise<ChatCommandRegistry> {
    const body = await this.requestJson<ListChatCommandsResponse>(
      'GET',
      COMMANDS_PATH,
      {},
    );
    return unwrapEnvelope(body);
  }

  /** Execute a slash/debug command for a session. */
  async sendCommand(
    sessionId: string,
    request: ExecuteChatCommandRequest,
    idempotencyKey?: string,
  ): Promise<ExecuteChatCommandResult> {
    const options: RequestOptions = {
      pathParams: { session_id: sessionId },
      body: request,
    };
    if (idempotencyKey !== undefined) {
      options.extraHeaders = { [HEADER_NAMES.idempotencyKey]: idempotencyKey };
    }
    const body = await this.requestJson<ExecuteChatCommandResponse>(
      'POST',
      SESSION_COMMANDS_PATH,
      options,
    );
    return unwrapEnvelope(body);
  }

  // ---- internal request infrastructure ----

  private buildUrl(
    path: string,
    pathParams?: Record<string, string>,
    query?: Record<string, unknown>,
  ): string {
    let resolvedPath = path;
    if (pathParams) {
      for (const [key, value] of Object.entries(pathParams)) {
        resolvedPath = resolvedPath.replace(
          `{${key}}`,
          encodeURIComponent(value),
        );
      }
    }

    const url = new URL(resolvedPath, this.config.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(options: RequestOptions): Headers {
    const headers = new Headers();
    if (options.body !== undefined) {
      headers.set(HEADER_NAMES.contentType, 'application/json');
    }
    if (this.config.bearerToken !== undefined) {
      headers.set(
        HEADER_NAMES.authorization,
        `Bearer ${this.config.bearerToken}`,
      );
    }
    if (options.extraHeaders) {
      for (const [name, value] of Object.entries(options.extraHeaders)) {
        headers.set(name, value);
      }
    }
    return headers;
  }

  private buildRequestInit(
    method: string,
    options: RequestOptions,
  ): RequestInit {
    const headers = this.buildHeaders(options);
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    return init;
  }

  private async requestJson<TBody>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<TBody> {
    const url = this.buildUrl(path, options.pathParams, options.query);
    const init = this.buildRequestInit(method, options);

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw classifyFetchError(error);
    }

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ChatTransportError({
        code: 'envelope_error',
        message: `Response body is not valid JSON (HTTP ${response.status})`,
        statusCode: response.status,
      });
    }

    return body as TBody;
  }

  private async handleHttpError(response: Response): Promise<never> {
    const statusCode = response.status;
    let apiError: ApiError | undefined;
    let message = `HTTP ${statusCode} ${response.statusText}`;

    try {
      const errorBody = (await response.json()) as unknown;
      if (isRecord(errorBody) && isRecord(errorBody['error'])) {
        // Justified cast: transport is the wire trust boundary; the backend
        // guarantees the error shape per the OpenAPI contract.
        apiError = errorBody['error'] as ApiError;
        message = apiError.message;
      }
    } catch {
      // Body is not JSON — fall back to status text.
    }

    const code =
      statusCode === 401 || statusCode === 403 ? 'auth_error' : 'http_error';

    const init: ChatTransportErrorInit = {
      code,
      message,
      statusCode,
      ...(apiError !== undefined ? { apiError } : {}),
    };
    throw new ChatTransportError(init);
  }
}

/**
 * Unwrap an API envelope: throw on ok=false or missing data, return the typed
 * data on success.
 */
function unwrapEnvelope<TData>(body: ApiEnvelope & { data?: TData }): TData {
  if (!body.ok) {
    const code =
      body.error?.code === 'unauthorized' || body.error?.code === 'forbidden'
        ? 'auth_error'
        : 'envelope_error';
    const init: ChatTransportErrorInit = {
      code,
      message: body.error?.message ?? 'API envelope reported ok=false',
      ...(body.error !== undefined ? { apiError: body.error } : {}),
    };
    throw new ChatTransportError(init);
  }

  if (body.data === undefined) {
    throw new ChatTransportError({
      code: 'envelope_error',
      message: 'API envelope ok=true but data field is missing',
    });
  }

  return body.data;
}
