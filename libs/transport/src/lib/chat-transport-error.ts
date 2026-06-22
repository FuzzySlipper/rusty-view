import type { ApiError } from '@rusty-view/protocol';

/**
 * Transport-layer error codes. Each code identifies a distinct failure mode so
 * the store and debug UI can react appropriately (retry vs surface vs abort).
 */
export type ChatTransportErrorCode =
  | 'config_error'
  | 'network_error'
  | 'http_error'
  | 'auth_error'
  | 'envelope_error'
  | 'sse_parse_error'
  | 'reconnect_exhausted'
  | 'aborted';

/** Options for constructing a {@link ChatTransportError}. */
export interface ChatTransportErrorInit {
  readonly code: ChatTransportErrorCode;
  readonly message: string;
  readonly statusCode?: number;
  readonly apiError?: ApiError;
  readonly cause?: unknown;
}

/**
 * Error thrown by all transport operations. Never a bare `Error` — the `code`
 * field lets callers distinguish network failures, auth failures, HTTP status
 * errors, envelope violations, and SSE parsing failures.
 */
export class ChatTransportError extends Error {
  readonly code: ChatTransportErrorCode;
  readonly statusCode?: number;
  readonly apiError?: ApiError;
  // `cause` is inherited from Error (es2022+ lib). Do not redeclare it.

  constructor(init: ChatTransportErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : {});
    this.name = 'ChatTransportError';
    this.code = init.code;

    // Assign optional fields conditionally to satisfy exactOptionalPropertyTypes.
    if (init.statusCode !== undefined) {
      this.statusCode = init.statusCode;
    }
    if (init.apiError !== undefined) {
      this.apiError = init.apiError;
    }
  }

  /**
   * Whether the operation is worth retrying. Network errors and 5xx are
   * retryable; auth errors, 4xx, config errors, and aborts are not.
   */
  get retryable(): boolean {
    switch (this.code) {
      case 'network_error':
        return true;
      case 'http_error':
        return this.statusCode !== undefined && this.statusCode >= 500;
      case 'auth_error':
        return false;
      case 'config_error':
        return false;
      case 'envelope_error':
        return false;
      case 'sse_parse_error':
        return false;
      case 'reconnect_exhausted':
        return false;
      case 'aborted':
        return false;
    }
  }
}

/**
 * Narrow an unknown caught value to a {@link ChatTransportError}, or wrap it.
 * Use in catch blocks to normalize error handling.
 */
export function toChatTransportError(
  error: unknown,
  fallbackCode: ChatTransportErrorCode = 'network_error',
): ChatTransportError {
  if (error instanceof ChatTransportError) {
    return error;
  }
  if (error instanceof Error) {
    return new ChatTransportError({
      code: fallbackCode,
      message: error.message,
      cause: error,
    });
  }
  return new ChatTransportError({
    code: fallbackCode,
    message: String(error),
    cause: error,
  });
}

/**
 * Classify a raw fetch error (thrown by `fetchImpl`) into a typed
 * {@link ChatTransportError}. Recognizes timeout and abort by DOMException name;
 * everything else is treated as a network error. Used by both the HTTP client
 * and the SSE stream reader.
 */
export function classifyFetchError(error: unknown): ChatTransportError {
  if (error instanceof ChatTransportError) {
    return error;
  }
  if (error instanceof Error) {
    const name = error.name;
    if (name === 'TimeoutError') {
      return new ChatTransportError({
        code: 'network_error',
        message: 'Request timed out',
        cause: error,
      });
    }
    if (name === 'AbortError') {
      return new ChatTransportError({
        code: 'aborted',
        message: 'Request aborted',
        cause: error,
      });
    }
  }
  return toChatTransportError(error, 'network_error');
}
