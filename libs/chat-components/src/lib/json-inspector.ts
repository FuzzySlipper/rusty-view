import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { WorkerManager } from '@rusty-view/transcript-renderer';

/**
 * Presentational raw JSON inspector for debugging.
 *
 * Pretty-prints and syntax-highlights any value as formatted JSON. Uses the
 * {@link WorkerManager} to offload large JSON processing off the main thread,
 * preventing frame drops when inspecting large tool-call results or debug
 * payloads. For small JSON (< 1000 chars), it pretty-prints inline for speed.
 */
@Component({
  selector: 'rv-json-inspector',
  template: `
    @if (highlightedHtml()) {
      <pre
        class="rv-json"
        data-testid="json-inspector"
        [innerHTML]="highlightedHtml()"
      ></pre>
    } @else {
      <pre class="rv-json" data-testid="json-inspector">{{
        formattedInline()
      }}</pre>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        overflow: auto;
        max-height: 400px;
      }
      .rv-json {
        margin: 0;
        padding: var(--rv-space-sm);
        font-family: var(--rv-font-technical);
        font-size: var(--rv-font-size-xs);
        line-height: var(--rv-line-height-normal);
        color: var(--rv-color-text-secondary);
        white-space: pre-wrap;
        word-break: break-all;
      }
      :host ::ng-deep .rv-json-key {
        color: var(--rv-color-accent);
      }
      :host ::ng-deep .rv-json-string {
        color: var(--rv-color-success);
      }
      :host ::ng-deep .rv-json-bool {
        color: var(--rv-color-warning);
      }
      :host ::ng-deep .rv-json-null {
        color: var(--rv-color-text-muted);
      }
      :host ::ng-deep .rv-json-number {
        color: var(--rv-color-danger);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonInspectorComponent {
  private readonly workerManager = inject(WorkerManager);

  readonly data = input<unknown>(undefined);
  readonly workerThreshold = input<number>(1_000);

  protected readonly highlightedHtml = signal<string>('');
  protected readonly formattedInline = signal<string>('—');

  constructor() {
    effect(() => {
      const value = this.data();
      if (value === undefined || value === null) {
        this.formattedInline.set('—');
        this.highlightedHtml.set('');
        return;
      }

      let jsonStr: string;
      try {
        jsonStr = JSON.stringify(value, null, 2);
      } catch {
        jsonStr = String(value);
      }

      if (jsonStr.length > this.workerThreshold()) {
        // Offload to worker for large JSON.
        this.formattedInline.set('');
        void this.highlightJson(jsonStr);
      } else {
        // Inline for small JSON (fast, no worker overhead).
        this.highlightedHtml.set('');
        this.formattedInline.set(jsonStr);
      }
    });
  }

  private async highlightJson(jsonStr: string): Promise<void> {
    const html = await this.workerManager.highlightJson(jsonStr);
    // Only update if the data hasn't changed during async processing.
    const currentValue = this.data();
    if (currentValue !== undefined && currentValue !== null) {
      try {
        if (JSON.stringify(currentValue, null, 2) === jsonStr) {
          this.highlightedHtml.set(html);
        }
      } catch {
        // value changed — ignore stale result
      }
    }
  }
}
