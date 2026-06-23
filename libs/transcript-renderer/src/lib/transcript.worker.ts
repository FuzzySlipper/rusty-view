/// <reference lib="webworker" />

/**
 * Web Worker for transcript rendering operations: markdown parsing, JSON
 * highlighting, and code highlighting. Runs off the main thread to prevent
 * frame drops during scroll/streaming with large messages.
 *
 * Bundled by @angular/build. The host loads this via the WorkerManager, which
 * falls back to inline processing if Worker is unavailable.
 */

import { processRequestInline } from './worker-inline-ops';
import type { WorkerRequest, WorkerResponse } from './worker-message-protocol';

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  const response: WorkerResponse = processRequestInline(request);
  self.postMessage(response);
};
