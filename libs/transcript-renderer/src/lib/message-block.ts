import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { MessageBlock } from '@rusty-view/chat-domain';

import { WorkerManager } from './worker-manager';
import {
  TRANSCRIPT_TEXT_RENDER_MODE,
  type TextRenderMode,
} from './render-mode-token';

/**
 * Renders a single {@link MessageBlock} by kind.
 *
 * - text → rendered according to the global {@link TextRenderMode}:
 *   `markdown` (worker-parsed), `sanitized-html` (pre-sanitized then Angular
 *   `[innerHTML]`), or `raw` (plain text). A per-block raw toggle overrides
 *   to raw so users can always recover.
 * - tool_call / tool_result / debug / command → collapsible panel
 *
 * Large blocks render the first N lines with an expand toggle. Text blocks use
 * the {@link WorkerManager} to parse/sanitize off the main thread when the
 * content exceeds the inline threshold, preventing frame drops during scroll
 * with very long messages.
 *
 * **Render modes** (task #3260):
 * - `raw` — plain text, no formatting. Always available as fallback.
 * - `markdown` — content parsed as Markdown → safe HTML.
 * - `sanitized-html` — content treated as inline HTML, pre-sanitized (strips
 *   scripts, event handlers, iframes, dangerous URLs) then bound via
 *   `[innerHTML]` for Angular's final sanitization layer.
 *
 * Per-block raw toggle: the `showRaw` signal overrides the global mode to
 * `raw`. The toggle button appears on text blocks when the global mode is not
 * already `raw`.
 */
@Component({
  selector: 'rv-message-block',
  templateUrl: './message-block.html',
  styleUrl: './message-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBlockComponent {
  private readonly workerManager = inject(WorkerManager);
  protected readonly renderMode = inject(TRANSCRIPT_TEXT_RENDER_MODE);

  readonly block = input.required<MessageBlock>();
  readonly collapsedThreshold = input<number>(500);
  /** Content length above which markdown/HTML processing goes to the worker. */
  readonly workerThreshold = input<number>(2_000);

  protected readonly expanded = signal(false);
  /** Per-block override: when true, show raw text regardless of global mode. */
  protected readonly showRaw = signal(false);

  /** Rendered HTML for text blocks (markdown-parsed or sanitized). */
  protected readonly renderedHtml = signal<string>('');

  /** Effective render mode: global mode unless per-block raw is toggled. */
  protected readonly effectiveRenderMode = computed<TextRenderMode>(
    () => (this.showRaw() ? 'raw' : this.renderMode()),
  );

  /** Whether this text block should render formatted content. */
  protected readonly shouldRenderFormatted = computed(
    () => this.effectiveRenderMode() !== 'raw',
  );

  /** Tool/command metadata, when this block represents inline tool activity. */
  protected readonly tool = computed(() => this.block().tool);

  /** Whether the tool block has expandable detail (result / reason). */
  protected readonly hasDetail = computed(
    () => this.block().content.length > 0,
  );

  protected readonly isCollapsible = computed(
    () => this.block().kind !== 'text',
  );

  protected readonly displayContent = computed(() => {
    const content = this.block().content;
    if (!this.isCollapsible() || this.expanded()) {
      return content;
    }
    const threshold = this.collapsedThreshold();
    if (content.length <= threshold) {
      return content;
    }
    return content.slice(0, threshold) + '…';
  });

  protected readonly isTruncated = computed(
    () =>
      this.isCollapsible() &&
      !this.expanded() &&
      this.block().content.length > this.collapsedThreshold(),
  );

  constructor() {
    // When the text block content changes OR the render mode changes,
    // render (or clear) formatted content accordingly.
    effect(() => {
      const block = this.block();
      if (block.kind !== 'text') {
        this.renderedHtml.set('');
        return;
      }
      const mode = this.effectiveRenderMode();
      if (mode === 'raw') {
        this.renderedHtml.set('');
        return;
      }
      const content = block.content;
      void this.renderFormatted(content, mode);
    });
  }

  protected toggleExpand(): void {
    this.expanded.update((v) => !v);
  }

  protected toggleRaw(): void {
    this.showRaw.update((v) => !v);
  }

  private async renderFormatted(
    content: string,
    mode: TextRenderMode,
  ): Promise<void> {
    const html =
      mode === 'sanitized-html'
        ? await this.workerManager.sanitizeHtml(content)
        : await this.workerManager.parseMarkdown(content);
    // Only update if the block hasn't changed during async processing
    // AND the render mode is still active.
    if (
      this.block().content === content &&
      this.effectiveRenderMode() === mode
    ) {
      this.renderedHtml.set(html);
    }
  }
}
