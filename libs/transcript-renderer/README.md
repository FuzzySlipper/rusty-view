# transcript-renderer

Virtualized, streaming-safe transcript rendering for Rusty View consumers.

## Web worker integration

Published Angular libraries cannot make an application builder discover a
worker entry through a library-local `new URL(..., import.meta.url)`. Consumers
that want off-thread markdown and code rendering provide an application-owned
worker factory:

```ts
import { TRANSCRIPT_WORKER_FACTORY, type TranscriptWorkerFactory } from '@rusty-view/transcript-renderer';

const transcriptWorkerFactory: TranscriptWorkerFactory = () => new Worker(new URL('./transcript.worker', import.meta.url));

export const appConfig = {
  providers: [
    {
      provide: TRANSCRIPT_WORKER_FACTORY,
      useValue: transcriptWorkerFactory,
    },
  ],
};
```

The application worker entry delegates to the package's shared operation
implementation:

```ts
/// <reference lib="webworker" />

import { processRequestInline, type WorkerRequest, type WorkerResponse } from '@rusty-view/transcript-renderer';

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const response: WorkerResponse = processRequestInline(event.data);
  self.postMessage(response);
};
```

When no factory is configured—or worker construction is blocked—the renderer
uses the same implementation on the main thread without issuing a broken
runtime request.

## Running unit tests

Run `nx test transcript-renderer` to execute the unit tests.
