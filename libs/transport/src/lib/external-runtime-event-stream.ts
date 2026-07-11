import type { NormalizedExternalRuntimeEvent } from '@rusty-view/protocol';

import { ChatTransportError, classifyFetchError } from './chat-transport-error';
import type { ExternalRuntimeHttpTransport } from './external-runtime-http-transport';
import { SseFrameParser } from './sse-frame-parser';

export class ExternalRuntimeEventStream {
  private readonly abortController = new AbortController();
  private closed = false;
  private cursor: number | undefined;

  constructor(
    private readonly http: ExternalRuntimeHttpTransport,
    private readonly runtimeId: string,
    initialCursor?: number,
  ) {
    this.cursor = initialCursor;
  }

  async *events(): AsyncGenerator<NormalizedExternalRuntimeEvent> {
    while (!this.closed) {
      try {
        yield* this.read();
        if (!this.closed) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        if (this.closed) return;
        if (
          error instanceof ChatTransportError &&
          (error.code === 'auth_error' ||
            (error.statusCode !== undefined &&
              error.statusCode >= 400 &&
              error.statusCode < 500))
        ) {
          throw error;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  close(): void {
    this.closed = true;
    this.abortController.abort();
  }

  private async *read(): AsyncGenerator<NormalizedExternalRuntimeEvent> {
    let response: Response;
    try {
      response = await this.http.fetch()(
        this.http.streamUrl(this.runtimeId, this.cursor),
        {
          headers: this.http.streamHeaders(this.cursor),
          signal: this.abortController.signal,
        },
      );
    } catch (error) {
      throw classifyFetchError(error);
    }
    if (!response.ok || response.body === null) {
      throw new ChatTransportError({
        code:
          response.status === 401 || response.status === 403
            ? 'auth_error'
            : 'http_error',
        message: `External runtime stream failed: HTTP ${response.status}`,
        statusCode: response.status,
      });
    }
    const parser = new SseFrameParser();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    while (!this.closed) {
      const chunk = await reader.read();
      if (chunk.done) return;
      for (const frame of parser.feed(
        decoder.decode(chunk.value, { stream: true }),
      )) {
        const event = JSON.parse(frame.data) as NormalizedExternalRuntimeEvent;
        this.cursor = event.sequenceId;
        yield event;
      }
    }
  }
}
