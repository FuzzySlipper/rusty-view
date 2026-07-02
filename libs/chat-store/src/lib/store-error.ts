import { ChatTransportError } from '@rusty-view/transport';
import type { ChatTransportErrorCode } from '@rusty-view/transport';

export interface StoreApiErrorDetail {
  readonly code: string;
  readonly reasonCode: string;
  readonly message: string;
  readonly retryable?: boolean;
}

export interface StoreErrorDetail {
  readonly source: 'transport' | 'error' | 'unknown';
  readonly message: string;
  readonly transportCode?: ChatTransportErrorCode;
  readonly statusCode?: number;
  readonly endpoint?: string;
  readonly retryable: boolean;
  readonly apiError?: StoreApiErrorDetail;
}

export function storeErrorDetail(error: unknown): StoreErrorDetail {
  if (error instanceof ChatTransportError) {
    return {
      source: 'transport',
      message: error.message,
      transportCode: error.code,
      ...(error.statusCode !== undefined
        ? { statusCode: error.statusCode }
        : {}),
      ...(error.endpoint !== undefined ? { endpoint: error.endpoint } : {}),
      retryable: error.retryable,
      ...(error.apiError !== undefined
        ? {
            apiError: {
              code: error.apiError.code,
              reasonCode: error.apiError.reason_code,
              message: error.apiError.message,
              ...(error.apiError.retryable !== undefined
                ? { retryable: error.apiError.retryable }
                : {}),
            },
          }
        : {}),
    };
  }
  if (error instanceof Error) {
    return {
      source: 'error',
      message: error.message,
      retryable: false,
    };
  }
  return {
    source: 'unknown',
    message: String(error),
    retryable: false,
  };
}

export function storeErrorMessage(error: unknown): string {
  return storeErrorDetailMessage(storeErrorDetail(error));
}

export function storeErrorDetailMessage(detail: StoreErrorDetail): string {
  const reasonCode = detail.apiError?.reasonCode;
  return reasonCode === undefined
    ? detail.message
    : `${detail.message} (${reasonCode})`;
}
