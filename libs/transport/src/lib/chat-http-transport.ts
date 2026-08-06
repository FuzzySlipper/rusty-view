import type {
  ApiEnvelope,
  ApiError,
  ChatCommandRegistry,
  ChatEvent,
  ChatEventPage,
  ChatSessionOpenResult,
  ChatSessionPage,
  ChatSessionStatus,
  ExecuteChatCommandRequest,
  ExecuteChatCommandResult,
  ExecuteChatCommandResponse,
  ConversationTreeProjection,
  CreateCrewChatSessionRequest,
  CreateCrewChatSessionResponse,
  CreateCrewChatSessionResult,
  GetConversationTreeResponse,
  GetChatSessionContextUsageResponse,
  GetChatProviderRequestDebugDetailResponse,
  GetChatToolCallDebugDetailResponse,
  ListChatCommandsResponse,
  ListChatSessionsResponse,
  ListChatSessionLogicalTurnsResponse,
  ListMessageSlotsResponse,
  ListMessageVariantsResponse,
  MessageSlotMutationResult,
  MessageSlotPage,
  MessageVariantPage,
  LogicalTurnCancelRequest,
  LogicalTurnControlReceipt,
  LogicalTurnDiagnosticPage,
  LogicalTurnResolveRequest,
  OpenChatSessionResponse,
  ProviderRequestDebugDetail,
  ReplayChatSessionEventsResponse,
  SendChatMessageRequest,
  SendChatMessageResponse,
  SendChatMessageResult,
  SelectActiveConversationBranchRequest,
  SelectActiveConversationBranchResponse,
  SelectActiveConversationBranchResult,
  SelectActiveMessageVariantRequest,
  SelectActiveMessageVariantResponse,
  SelectActiveMessageVariantResult,
  SessionContextUsageResult,
  ToolCallDebugDetail,
  DeleteMessageVariantResponse,
  CancelChatSessionLogicalTurnResponse,
  ResolveChatSessionLogicalTurnResponse,
} from '@rusty-view/protocol';

import {
  HEADER_NAMES,
  SESSIONS_PATH,
  SESSION_PATH,
  SESSION_EVENTS_PATH,
  SESSION_CONTEXT_PATH,
  SESSION_LOGICAL_TURNS_PATH,
  SESSION_LOGICAL_TURN_CANCEL_PATH,
  SESSION_LOGICAL_TURN_RESOLVE_PATH,
  SESSION_PROVIDER_REQUEST_DEBUG_DETAIL_PATH,
  SESSION_TOOL_CALL_DEBUG_DETAIL_PATH,
  SESSION_MESSAGES_PATH,
  SESSION_ACTIVE_BRANCH_PATH,
  SESSION_SLOT_ACTIVE_VARIANT_PATH,
  SESSION_SLOT_VARIANT_PATH,
  SESSION_SLOT_VARIANTS_PATH,
  SESSION_SLOTS_PATH,
  SESSION_TREE_PATH,
  COMMANDS_PATH,
  SESSION_COMMANDS_PATH,
} from './chat-routes';
import {
  ChatTransportError,
  classifyFetchError,
  withChatTransportEndpoint,
} from './chat-transport-error';
import type { ChatTransportErrorInit } from './chat-transport-error';
import type { ChatTransportConfig } from './chat-transport-config';
import type { FetchImpl } from './chat-transport-config';
import { parseChatEventObject } from './chat-event-parser';

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
  /**
   * Per-request timeout override (ms). Falls back to the config read timeout
   * when omitted. `0` disables the timeout (no abort signal) — used for
   * agent-waking writes that legitimately outlast the read timeout.
   */
  timeoutMs?: number;
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
    // Bind fetch to globalThis: in the browser, storing `globalThis.fetch` as
    // a bare reference and calling it later loses the `this` context (Window),
    // causing 'Illegal invocation'. Binding ensures correct context everywhere.
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
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

  /** Create, replay, or recover one Crew-brain session for an active profile. */
  async createCrewSession(
    request: CreateCrewChatSessionRequest,
    idempotencyKey: string,
  ): Promise<CreateCrewChatSessionResult> {
    const body = await this.requestJson<CreateCrewChatSessionResponse>(
      'POST',
      SESSIONS_PATH,
      {
        body: request,
        extraHeaders: { [HEADER_NAMES.idempotencyKey]: idempotencyKey },
        timeoutMs: this.config.writeTimeoutMs,
      },
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
    const result = unwrapEnvelope(body);
    return {
      ...result,
      events: result.events.map((event) => parseChatEventObject(event)),
    };
  }

  /**
   * Replay a single page of historical events after a cursor. Returns the raw
   * page (`{ items, latest_cursor, has_more }`) so callers can follow the cursor
   * across pages; most callers want {@link replayAllEvents} instead.
   */
  async replayEventsPage(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEventPage> {
    const body = await this.requestJson<ReplayChatSessionEventsResponse>(
      'GET',
      SESSION_EVENTS_PATH,
      {
        pathParams: { session_id: sessionId },
        ...(query !== undefined ? { query } : {}),
      },
    );
    const result = unwrapEnvelope(body);
    return {
      ...result,
      items: result.items.map((event) => parseChatEventObject(event)),
    };
  }

  /** Replay one page of historical events after a cursor (items only). */
  async replayEvents(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEvent[]> {
    return (await this.replayEventsPage(sessionId, query)).items;
  }

  /**
   * Guard against a malformed/non-advancing cursor pinning the catch-up loop:
   * even a well-behaved backend paginates a large turn into a bounded number of
   * pages, so stop after this many. A single assistant response can produce
   * hundreds of events, so allow plenty of pages before bailing.
   */
  static readonly MAX_REPLAY_PAGES = 200;

  /**
   * Replay ALL historical events after a cursor, following the page's
   * `has_more`/`latest_cursor` until the backend reports no more (task #3865).
   *
   * Crew paginates event replay: a single assistant turn can span hundreds of
   * events across several pages. Consuming only the first page can stop the
   * transcript mid-turn (e.g. the terminal `assistant_turn_finished` lands on a
   * later page), leaving the UI wedged as "streaming" until a manual refresh.
   *
   * Termination is guarded three ways so a malformed cursor cannot loop forever:
   * `has_more === false`, a `latest_cursor` that fails to advance, and a hard
   * {@link MAX_REPLAY_PAGES} page cap.
   */
  async replayAllEvents(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEvent[]> {
    const all: ChatEvent[] = [];
    let cursor = query?.cursor;
    for (let page = 0; page < ChatHttpTransport.MAX_REPLAY_PAGES; page++) {
      const result = await this.replayEventsPage(sessionId, {
        ...(query ?? {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      all.push(...result.items);
      if (!result.has_more) break;
      // A cursor that does not advance would page the same events forever.
      if (result.latest_cursor === cursor) break;
      cursor = result.latest_cursor;
    }
    return all;
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
      // Waking the agent blocks until the turn completes — outlasts the read
      // timeout, so use the generous write timeout (see writeTimeoutMs).
      timeoutMs: this.config.writeTimeoutMs,
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

  /**
   * Read model/provider/brain and approximate context-usage diagnostics for a
   * session (tasks #3788/#3847). Browser-safe: the backend redacts provider
   * secrets and returns only host/redacted base URLs. Includes the session's
   * current context-strategy policy and the latest compaction artifact metadata.
   */
  async sessionContext(sessionId: string): Promise<SessionContextUsageResult> {
    const body = await this.requestJson<GetChatSessionContextUsageResponse>(
      'GET',
      SESSION_CONTEXT_PATH,
      { pathParams: { session_id: sessionId } },
    );
    return unwrapEnvelope(body);
  }

  async listLogicalTurns(
    sessionId: string,
    limit = 100,
  ): Promise<LogicalTurnDiagnosticPage> {
    const body = await this.requestJson<ListChatSessionLogicalTurnsResponse>(
      'GET',
      SESSION_LOGICAL_TURNS_PATH,
      { pathParams: { session_id: sessionId }, query: { limit } },
    );
    return unwrapEnvelope(body);
  }

  async cancelLogicalTurn(
    sessionId: string,
    logicalTurnId: string,
    request: LogicalTurnCancelRequest,
    idempotencyKey: string,
  ): Promise<LogicalTurnControlReceipt> {
    const body = await this.requestJson<CancelChatSessionLogicalTurnResponse>(
      'POST',
      SESSION_LOGICAL_TURN_CANCEL_PATH,
      {
        pathParams: {
          session_id: sessionId,
          logical_turn_id: logicalTurnId,
        },
        body: request,
        extraHeaders: { [HEADER_NAMES.idempotencyKey]: idempotencyKey },
        timeoutMs: this.config.writeTimeoutMs,
      },
    );
    return unwrapEnvelope(body);
  }

  async resolveLogicalTurn(
    sessionId: string,
    logicalTurnId: string,
    request: LogicalTurnResolveRequest,
  ): Promise<LogicalTurnControlReceipt> {
    const body = await this.requestJson<ResolveChatSessionLogicalTurnResponse>(
      'POST',
      SESSION_LOGICAL_TURN_RESOLVE_PATH,
      {
        pathParams: {
          session_id: sessionId,
          logical_turn_id: logicalTurnId,
        },
        body: request,
        timeoutMs: this.config.writeTimeoutMs,
      },
    );
    return unwrapEnvelope(body);
  }

  /**
   * Read bounded/redacted raw tool-call debug detail on demand. Normal chat
   * events only carry the debug detail id; this route fetches the heavier raw
   * inspection payload lazily when the UI drilldown is opened.
   */
  async toolCallDebugDetail(
    sessionId: string,
    debugDetailId: string,
  ): Promise<ToolCallDebugDetail> {
    const body = await this.requestJson<GetChatToolCallDebugDetailResponse>(
      'GET',
      SESSION_TOOL_CALL_DEBUG_DETAIL_PATH,
      {
        pathParams: {
          session_id: sessionId,
          debug_detail_id: debugDetailId,
        },
      },
    );
    return unwrapEnvelope(body);
  }

  /**
   * Read bounded/redacted provider request debug detail on demand. Normal
   * provider_status events only carry the debug detail id and metadata.
   */
  async providerRequestDebugDetail(
    sessionId: string,
    debugDetailId: string,
  ): Promise<ProviderRequestDebugDetail> {
    const body =
      await this.requestJson<GetChatProviderRequestDebugDetailResponse>(
        'GET',
        SESSION_PROVIDER_REQUEST_DEBUG_DETAIL_PATH,
        {
          pathParams: {
            session_id: sessionId,
            debug_detail_id: debugDetailId,
          },
        },
      );
    return unwrapEnvelope(body);
  }

  async listMessageSlots(
    sessionId: string,
    query?: { limit?: number; offset?: number; include_alternates?: boolean },
  ): Promise<MessageSlotPage> {
    const body = await this.requestJson<ListMessageSlotsResponse>(
      'GET',
      SESSION_SLOTS_PATH,
      {
        pathParams: { session_id: sessionId },
        ...(query !== undefined ? { query } : {}),
      },
    );
    return unwrapEnvelope(body);
  }

  async listMessageVariants(
    sessionId: string,
    slotId: string,
    query?: { limit?: number; offset?: number },
  ): Promise<MessageVariantPage> {
    const body = await this.requestJson<ListMessageVariantsResponse>(
      'GET',
      SESSION_SLOT_VARIANTS_PATH,
      {
        pathParams: { session_id: sessionId, slot_id: slotId },
        ...(query !== undefined ? { query } : {}),
      },
    );
    return unwrapEnvelope(body);
  }

  async selectActiveMessageVariant(
    sessionId: string,
    slotId: string,
    request: SelectActiveMessageVariantRequest,
  ): Promise<SelectActiveMessageVariantResult> {
    const body = await this.requestJson<SelectActiveMessageVariantResponse>(
      'POST',
      SESSION_SLOT_ACTIVE_VARIANT_PATH,
      {
        pathParams: { session_id: sessionId, slot_id: slotId },
        body: request,
      },
    );
    return unwrapEnvelope(body);
  }

  async deleteMessageVariant(
    sessionId: string,
    slotId: string,
    variantId: string,
  ): Promise<MessageSlotMutationResult> {
    const body = await this.requestJson<DeleteMessageVariantResponse>(
      'DELETE',
      SESSION_SLOT_VARIANT_PATH,
      {
        pathParams: {
          session_id: sessionId,
          slot_id: slotId,
          variant_id: variantId,
        },
      },
    );
    return unwrapEnvelope(body);
  }

  async conversationTree(
    sessionId: string,
    query?: { limit?: number; offset?: number; exclude_snapshots?: boolean },
  ): Promise<ConversationTreeProjection> {
    const body = await this.requestJson<GetConversationTreeResponse>(
      'GET',
      SESSION_TREE_PATH,
      {
        pathParams: { session_id: sessionId },
        ...(query !== undefined ? { query } : {}),
      },
    );
    return unwrapEnvelope(body);
  }

  async selectActiveConversationBranch(
    sessionId: string,
    request: SelectActiveConversationBranchRequest,
  ): Promise<SelectActiveConversationBranchResult> {
    const body = await this.requestJson<SelectActiveConversationBranchResponse>(
      'POST',
      SESSION_ACTIVE_BRANCH_PATH,
      {
        pathParams: { session_id: sessionId },
        body: request,
      },
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
      // Commands can run an agent turn too — use the generous write timeout.
      timeoutMs: this.config.writeTimeoutMs,
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
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const init: RequestInit = {
      method,
      headers,
      // A timeout of 0 disables the abort signal (unbounded write); any positive
      // value caps the request as before.
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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
      throw withChatTransportEndpoint(classifyFetchError(error), url);
    }

    if (!response.ok) {
      await this.handleHttpError(response, url);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ChatTransportError({
        code: 'envelope_error',
        message: `Response body is not valid JSON (HTTP ${response.status})`,
        statusCode: response.status,
        endpoint: url,
      });
    }

    return body as TBody;
  }

  private async handleHttpError(
    response: Response,
    endpoint: string,
  ): Promise<never> {
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
      endpoint,
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
