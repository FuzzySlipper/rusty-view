import type {
  ChatCommandRegistry,
  ChatEvent,
  ChatSessionOpenResult,
  ChatSessionPage,
  ExecuteChatCommandRequest,
  ExecuteChatCommandResult,
  SendChatMessageRequest,
  SendChatMessageResult,
} from '@rusty-view/protocol';

import { ChatHttpTransport } from './chat-http-transport';
import type {
  ListSessionsQuery,
  OpenSessionQuery,
  ReplayEventsQuery,
} from './chat-http-transport';
import { ChatEventStream } from './chat-event-stream';
import type { SleepFunction } from './chat-event-stream';
import { defaultSleep } from './chat-event-stream';
import type {
  ChatTransportConfig,
  ChatTransportConfigInput,
  FetchImpl,
} from './chat-transport-config';
import { resolveChatTransportConfig } from './chat-transport-config';

/** Options for {@link ChatTransport.streamEvents}. */
export interface StreamEventsOptions {
  /** Resume from this cursor (from a previous session's getLastCursor). */
  readonly initialCursor?: string;
  /** Override sleep (testing). Defaults to real setTimeout. */
  readonly sleep?: SleepFunction;
}

/**
 * Public transport client for the Rusty Crew chat session API.
 *
 * Composes {@link ChatHttpTransport} (request/response HTTP) and
 * {@link ChatEventStream} (SSE streaming). Owns ALL backend communication —
 * no transport code exists outside this package.
 *
 * Framework-neutral: no Angular. The Angular chat-store adapts connection
 * state to Signals.
 *
 * Create one per debug-app instance (or per browser tab). The config is
 * resolved and frozen at construction; bearer tokens are never persisted.
 */
export class ChatTransport {
  private readonly config: ChatTransportConfig;
  private readonly http: ChatHttpTransport;
  private readonly fetchImpl: FetchImpl;

  constructor(configInput: ChatTransportConfigInput) {
    this.config = resolveChatTransportConfig(configInput);
    this.http = new ChatHttpTransport(this.config);
    this.fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
  }

  getConfig(): Readonly<ChatTransportConfig> {
    return this.config;
  }

  // ---- HTTP endpoints (delegate to ChatHttpTransport) ----

  listSessions(query?: ListSessionsQuery): Promise<ChatSessionPage> {
    return this.http.listSessions(query);
  }

  openSession(
    sessionId: string,
    query?: OpenSessionQuery,
  ): Promise<ChatSessionOpenResult> {
    return this.http.openSession(sessionId, query);
  }

  replayEvents(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEvent[]> {
    return this.http.replayEvents(sessionId, query);
  }

  sendMessage(
    sessionId: string,
    request: SendChatMessageRequest,
    idempotencyKey?: string,
  ): Promise<SendChatMessageResult> {
    return this.http.sendMessage(sessionId, request, idempotencyKey);
  }

  listCommands(): Promise<ChatCommandRegistry> {
    return this.http.listCommands();
  }

  sendCommand(
    sessionId: string,
    request: ExecuteChatCommandRequest,
    idempotencyKey?: string,
  ): Promise<ExecuteChatCommandResult> {
    return this.http.sendCommand(sessionId, request, idempotencyKey);
  }

  // ---- SSE event stream ----

  /**
   * Open a live SSE event stream for a chat session. Returns a
   * {@link ChatEventStream} whose `events()` async iterator yields typed
   * {@link ChatEvent} values, reconnecting transparently on disconnect.
   *
   * The caller is responsible for calling `close()` when done (e.g. when the
   * Angular store is destroyed or the user navigates away).
   */
  streamEvents(
    sessionId: string,
    options?: StreamEventsOptions,
  ): ChatEventStream {
    const sleep = options?.sleep ?? defaultSleep;
    return new ChatEventStream({
      config: this.config,
      sessionId,
      fetchImpl: this.fetchImpl,
      sleep,
      ...(options?.initialCursor !== undefined
        ? { initialCursor: options.initialCursor }
        : {}),
    });
  }
}

// Query types re-exported for callers; see chat-http-transport for definitions.
