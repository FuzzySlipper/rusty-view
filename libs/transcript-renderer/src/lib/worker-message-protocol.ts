/**
 * Typed message protocol for the transcript worker.
 *
 * Discriminated unions for request/response so the worker↔host boundary is
 * type-safe and exhaustive. Adding a new operation requires adding a variant
 * to both `WorkerRequest` and `WorkerResponse`.
 */

export type WorkerRequest =
  | {
      readonly kind: 'parse-markdown';
      readonly id: number;
      readonly content: string;
    }
  | {
      readonly kind: 'highlight-json';
      readonly id: number;
      readonly content: string;
    }
  | {
      readonly kind: 'highlight-code';
      readonly id: number;
      readonly content: string;
      readonly language: string;
    };

export type WorkerResponse =
  | {
      readonly kind: 'parse-markdown';
      readonly id: number;
      readonly html: string;
    }
  | {
      readonly kind: 'highlight-json';
      readonly id: number;
      readonly html: string;
    }
  | {
      readonly kind: 'highlight-code';
      readonly id: number;
      readonly html: string;
    }
  | { readonly kind: 'error'; readonly id: number; readonly message: string };

/** The subset of WorkerRequest kinds that produce results (not errors). */
export type WorkerOperationKind =
  | 'parse-markdown'
  | 'highlight-json'
  | 'highlight-code';
