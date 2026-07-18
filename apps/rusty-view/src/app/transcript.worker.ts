/// <reference lib="webworker" />

import {
  processRequestInline,
  type WorkerRequest,
  type WorkerResponse,
} from '@rusty-view/transcript-renderer';

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const response: WorkerResponse = processRequestInline(event.data);
  self.postMessage(response);
};
