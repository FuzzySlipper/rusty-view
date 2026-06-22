import type { ChatEvent } from '@rusty-view/protocol';

import { parseChatEvent } from './chat-event-parser';
import { ChatTransportError, classifyFetchError } from './chat-transport-error';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { HEADER_NAMES, QUERY_PARAMS, SESSION_STREAM_PATH } from './chat-routes';
import {
  ConnectionStateTracker,
  type ChatConnectionState,
  type ConnectionStateListener,
  type Unsubscribe,
} from './connection-state';
import { SseFrameParser } from './sse-frame-parser';

/** Sleep function (injectable for testing). */
export type SleepFunction = (ms: number) => Promise<void>;

/** Default production sleep: real setTimeout. */
export const defaultSleep: SleepFunction = (ms) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Compute bounded exponential backoff delay for a given attempt.
 *
 * Pure and deterministic (no jitter) so it is unit-testable. Production callers
 * may add jitter before sleeping if desired.
 *
 * - attempt 0 → initialMs
 * - attempt 1 → initialMs * 2
 * - attempt N → initialMs * 2^N, capped at maxMs
 */
export function calculateBackoffDelay(
  attempt: number,
  initialMs: number,
  maxMs: number,
): number {
  if (attempt < 0) {
    return initialMs;
  }
  const exponential = initialMs * Math.pow(2, attempt);
  return Math.min(exponential, maxMs);
}

/** Options for creating a {@link ChatEventStream}. */
export interface ChatEventStreamOptions {
  readonly config: ChatTransportConfig;
  readonly sessionId: string;
  readonly initialCursor?: string;
  readonly fetchImpl: FetchImpl;
  readonly sleep: SleepFunction;
}

/**
 * A live SSE event-stream session for one chat session.
 *
 * Uses fetch (not EventSource) so it can send `Authorization` headers for
 * bearer-token auth — EventSource cannot set custom headers. The response body
 * is read incrementally, fed through {@link SseFrameParser}, and each frame's
 * JSON `data` is parsed into a typed {@link ChatEvent}.
 *
 * On transport-level disconnect (stream body ends or a network error occurs),
 * the session reconnects with bounded exponential backoff, resuming from the
 * last successfully processed event cursor. `close()` aborts the current
 * connection and stops reconnection permanently.
 *
 * Application-level `stream_error` events are yielded to the caller (the
 * store/projection layer decides what to do with them) — they do NOT trigger
 * reconnection (the error might be permanent).
 */
export class ChatEventStream {
  private readonly options: ChatEventStreamOptions;
  private readonly stateTracker = new ConnectionStateTracker();
  private readonly abortController = new AbortController();

  private lastCursor: string | undefined;
  private closed = false;
  private reconnectAttempt = 0;

  constructor(options: ChatEventStreamOptions) {
    this.options = options;
    this.lastCursor = options.initialCursor;
  }

  /** Async iterator over chat events. Reconnects transparently on disconnect. */
  async *events(): AsyncGenerator<ChatEvent> {
    while (!this.closed) {
      this.setState({ status: 'connecting' });

      let streamEndedNormally = false;
      try {
        yield* this.connectAndRead();
        streamEndedNormally = true;
      } catch (error) {
        if (this.closed) {
          return;
        }
        // Network or HTTP error during connection — will reconnect below.
        // Auth errors are non-retryable: surface immediately.
        if (
          error instanceof ChatTransportError &&
          error.code === 'auth_error'
        ) {
          this.setState({ status: 'error', error });
          throw error;
        }
      }

      if (this.closed) {
        return;
      }

      // Stream ended or errored — attempt reconnection with backoff.
      if (this.reconnectAttempt >= this.options.config.reconnectMaxAttempts) {
        const exhausted = new ChatTransportError({
          code: 'reconnect_exhausted',
          message: `Max reconnection attempts (${this.options.config.reconnectMaxAttempts}) exhausted${streamEndedNormally ? ' after server closed stream' : ' after network errors'}.`,
        });
        this.setState({ status: 'error', error: exhausted });
        throw exhausted;
      }

      const delayMs = calculateBackoffDelay(
        this.reconnectAttempt,
        this.options.config.reconnectInitialMs,
        this.options.config.reconnectMaxMs,
      );
      this.reconnectAttempt += 1;

      this.setState({
        status: 'reconnecting',
        attempt: this.reconnectAttempt,
        nextAttemptMs: delayMs,
        ...(this.lastCursor !== undefined
          ? { lastCursor: this.lastCursor }
          : {}),
      });

      await this.options.sleep(delayMs);
    }
  }

  getState(): ChatConnectionState {
    return this.stateTracker.getState();
  }

  onStateChange(listener: ConnectionStateListener): Unsubscribe {
    return this.stateTracker.subscribe(listener);
  }

  getLastCursor(): string | undefined {
    return this.lastCursor;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.abortController.abort();
    this.setState({ status: 'closed' });
    this.stateTracker.clear();
  }

  // ---- internal ----

  private setState(next: ChatConnectionState): void {
    this.stateTracker.setState(next);
  }

  private buildStreamUrl(): string {
    const baseUrl = this.options.config.baseUrl;
    const path = SESSION_STREAM_PATH.replace(
      '{session_id}',
      encodeURIComponent(this.options.sessionId),
    );
    const url = new URL(path, baseUrl);
    if (this.lastCursor !== undefined) {
      url.searchParams.set(QUERY_PARAMS.cursor, this.lastCursor);
    }
    return url.toString();
  }

  private buildStreamHeaders(): Headers {
    const headers = new Headers({
      Accept: 'text/event-stream',
    });
    if (this.options.config.bearerToken !== undefined) {
      headers.set(
        HEADER_NAMES.authorization,
        `Bearer ${this.options.config.bearerToken}`,
      );
    }
    if (this.lastCursor !== undefined) {
      headers.set(HEADER_NAMES.lastEventId, this.lastCursor);
    }
    return headers;
  }

  private async *connectAndRead(): AsyncGenerator<ChatEvent> {
    const url = this.buildStreamUrl();
    const headers = this.buildStreamHeaders();

    let response: Response;
    try {
      response = await this.options.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: this.abortController.signal,
      });
    } catch (error) {
      throw classifyFetchError(error);
    }

    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'auth_error'
          : 'http_error';
      throw new ChatTransportError({
        code,
        message: `SSE stream failed: HTTP ${response.status} ${response.statusText}`,
        statusCode: response.status,
      });
    }

    // Successful connection — reset the reconnect counter.
    this.reconnectAttempt = 0;
    this.setState({
      status: 'connected',
      ...(this.lastCursor !== undefined ? { lastCursor: this.lastCursor } : {}),
    });

    const body = response.body;
    if (body === null) {
      throw new ChatTransportError({
        code: 'network_error',
        message: 'SSE stream response has no readable body',
      });
    }

    const reader = body.getReader();
    const parser = new SseFrameParser();
    const decoder = new TextDecoder();

    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        const frames = parser.feed(text);

        for (const frame of frames) {
          const event = parseChatEvent(frame.data);
          this.lastCursor = event.event_id;
          yield event;
        }
      }

      // Flush any remaining buffered text in the decoder.
      const remaining = decoder.decode();
      if (remaining.length > 0 && !this.closed) {
        const finalFrames = parser.feed(remaining);
        for (const frame of finalFrames) {
          const event = parseChatEvent(frame.data);
          this.lastCursor = event.event_id;
          yield event;
        }
      }
    } catch (error) {
      if (this.closed) {
        // Expected: close() aborted the reader.
        return;
      }
      throw classifyFetchError(error);
    } finally {
      reader.releaseLock();
    }
  }
}
