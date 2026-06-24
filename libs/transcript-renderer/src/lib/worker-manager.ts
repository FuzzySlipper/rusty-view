import { Injectable } from '@angular/core';

import { processRequestInline } from './worker-inline-ops';
import type {
  WorkerOperationKind,
  WorkerRequest,
  WorkerResponse,
} from './worker-message-protocol';

/**
 * Manages the transcript worker lifecycle and provides a typed async API for
 * offloading expensive operations (markdown parsing, JSON/code highlighting).
 *
 * The worker is initialized lazily — not spun up until the first operation. If
 * `Worker` is unavailable (SSR, test environments), the manager falls back to
 * inline main-thread processing transparently.
 *
 * Callers use {@link parseMarkdown}, {@link highlightJson}, or
 * {@link highlightCode} and receive an HTML string. The worker/inline
 * distinction is hidden behind the interface.
 */
@Injectable({ providedIn: 'root' })
export class WorkerManager {
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (html: string) => void; reject: (error: Error) => void }
  >();
  private workerSupported: boolean = typeof Worker !== 'undefined';

  /** Parse markdown content into HTML (off-thread if possible). */
  parseMarkdown(content: string): Promise<string> {
    return this.dispatch('parse-markdown', content);
  }

  /** Sanitize raw HTML for safe rendering (off-thread if possible). */
  sanitizeHtml(content: string): Promise<string> {
    return this.dispatch('sanitize-html', content);
  }

  /** Pretty-print and syntax-highlight JSON (off-thread if possible). */
  highlightJson(content: string): Promise<string> {
    return this.dispatch('highlight-json', content);
  }

  /** Syntax-highlight code (off-thread if possible). */
  highlightCode(content: string, language: string): Promise<string> {
    return this.dispatch('highlight-code', content, language);
  }

  /** Whether the manager is currently using a real Web Worker. */
  isUsingWorker(): boolean {
    return this.workerSupported && this.worker !== null;
  }

  /** Terminate the worker (cleanup). */
  dispose(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const { reject } of this.pending.values()) {
      reject(new Error('WorkerManager disposed'));
    }
    this.pending.clear();
  }

  // ---- internal ----

  private dispatch(
    kind: WorkerOperationKind,
    content: string,
    language?: string,
  ): Promise<string> {
    const id = this.nextId++;

    if (!this.workerSupported) {
      // Inline fallback — no worker available.
      return Promise.resolve(this.processInline(kind, id, content, language));
    }

    this.ensureWorker();
    if (this.worker === null) {
      // Worker creation failed — fall back to inline.
      return Promise.resolve(this.processInline(kind, id, content, language));
    }

    // this.worker is guaranteed non-null here (checked above).
    const worker = this.worker as Worker;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      const request = this.buildRequest(kind, id, content, language);
      worker.postMessage(request);
    });
  }

  private ensureWorker(): void {
    if (this.worker !== null) return;
    try {
      this.worker = new Worker(
        new URL('./transcript.worker.ts', import.meta.url),
      );
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleResponse(event.data);
      };
      this.worker.onerror = (event: ErrorEvent) => {
        // Worker errored — reject all pending and fall back to inline.
        const error = new Error(event.message || 'Worker error');
        for (const { reject } of this.pending.values()) {
          reject(error);
        }
        this.pending.clear();
        this.workerSupported = false;
        this.worker = null;
      };
    } catch {
      // Worker construction failed (e.g. CSP, unsupported) — use inline.
      this.workerSupported = false;
    }
  }

  private handleResponse(response: WorkerResponse): void {
    const entry = this.pending.get(response.id);
    if (entry === undefined) return;

    this.pending.delete(response.id);
    if (response.kind === 'error') {
      entry.reject(new Error(response.message));
    } else {
      entry.resolve(response.html);
    }
  }

  private buildRequest(
    kind: WorkerOperationKind,
    id: number,
    content: string,
    language?: string,
  ): WorkerRequest {
    if (kind === 'highlight-code' && language !== undefined) {
      return { kind: 'highlight-code', id, content, language };
    }
    if (kind === 'parse-markdown') {
      return { kind: 'parse-markdown', id, content };
    }
    if (kind === 'sanitize-html') {
      return { kind: 'sanitize-html', id, content };
    }
    return { kind: 'highlight-json', id, content };
  }

  private processInline(
    kind: WorkerOperationKind,
    id: number,
    content: string,
    language?: string,
  ): string {
    const request = this.buildRequest(kind, id, content, language);
    const response = processRequestInline(request);
    if (response.kind === 'error') {
      throw new Error(response.message);
    }
    return response.html;
  }
}
