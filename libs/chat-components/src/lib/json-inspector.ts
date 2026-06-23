import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Presentational raw JSON inspector for debugging.
 *
 * Pretty-prints any value as formatted JSON. Used in the debug app's inspector
 * panels to inspect raw events, messages, and tool calls.
 */
@Component({
  selector: 'rv-json-inspector',
  template: ` <pre class="rv-json">{{ formatted() }}</pre> `,
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
        font-family: var(--rv-font-mono);
        font-size: var(--rv-font-size-xs);
        line-height: var(--rv-line-height-normal);
        color: var(--rv-color-text-secondary);
        white-space: pre-wrap;
        word-break: break-all;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonInspectorComponent {
  readonly data = input<unknown>(undefined);

  protected formatted(): string {
    const value = this.data();
    if (value === undefined || value === null) {
      return '—';
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}
