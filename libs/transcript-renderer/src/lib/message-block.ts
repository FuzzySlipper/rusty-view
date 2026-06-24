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
import { TRANSCRIPT_MARKDOWN_ENABLED } from './markdown-render-token';

/**
 * Renders a single {@link MessageBlock} by kind.
 *
 * - text → markdown-rendered (via worker for large content) when the global
 *   Markdown preference is on and the user hasn't toggled this block to raw.
 * - tool_call / tool_result / debug / command → collapsible panel
 *
 * Large blocks render the first N lines with an expand toggle. Text blocks use
 * the {@link WorkerManager} to parse markdown off the main thread when the
 * content exceeds the inline threshold, preventing frame drops during scroll
 * with very long messages.
 *
 * **Markdown rendering**: the global on/off comes from
 * {@link TRANSCRIPT_MARKDOWN_ENABLED} (a signal injected from the host). A
 * per-block "raw" toggle ( {@link showRaw} ) lets the user flip an individual
 * response to plain text when rendering is wrong, slow, or confusing. Raw text
 * is always available and copyable.
 *
 * **Streaming behavior**: markdown is rendered for all text blocks including
 * those in an active streaming turn. The worker processes asynchronously so
 * streaming deltas don't block the UI, and a guard prevents stale renders. If
 * live markdown parsing creates churn in practice, hosts can set the global
 * preference to `false` or users can toggle individual blocks to raw.
 */
@Component({
  selector: 'rv-message-block',
  templateUrl: './message-block.html',
  styleUrl: './message-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBlockComponent {
  private readonly workerManager = inject(WorkerManager);
  protected readonly markdownEnabled = inject(TRANSCRIPT_MARKDOWN_ENABLED);

  readonly block = input.required<MessageBlock>();
  readonly collapsedThreshold = input<number>(500);
  /** Content length above which markdown parsing goes to the worker. */
  readonly workerThreshold = input<number>(2_000);

  protected readonly expanded = signal(false);
  /** Per-block override: when true, show raw text instead of rendered Markdown. */
  protected readonly showRaw = signal(false);

  /** Rendered HTML for text blocks (markdown-parsed). */
  protected readonly renderedHtml = signal<string>('');

  /** Whether this text block should render as formatted Markdown. */
  protected readonly shouldRenderMarkdown = computed(
    () => this.markdownEnabled() && !this.showRaw(),
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
    // When the text block content changes OR the render-mode changes,
    // render (or clear) markdown accordingly.
    effect(() => {
      const block = this.block();
      if (block.kind !== 'text') {
        this.renderedHtml.set('');
        return;
      }
      if (!this.shouldRenderMarkdown()) {
        this.renderedHtml.set('');
        return;
      }
      const content = block.content;
      // Fire and forget — the signal updates when the worker responds.
      void this.renderMarkdown(content);
    });
  }

  protected toggleExpand(): void {
    this.expanded.update((v) => !v);
  }

  protected toggleRaw(): void {
    this.showRaw.update((v) => !v);
  }

  private async renderMarkdown(content: string): Promise<void> {
    const html = await this.workerManager.parseMarkdown(content);
    // Only update if the block hasn't changed during async processing
    // AND the render mode is still active.
    if (this.block().content === content && this.shouldRenderMarkdown()) {
      this.renderedHtml.set(html);
    }
  }
}