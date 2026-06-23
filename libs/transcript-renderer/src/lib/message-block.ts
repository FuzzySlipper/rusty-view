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

/**
 * Renders a single {@link MessageBlock} by kind.
 *
 * - text → markdown-rendered (via worker for large content)
 * - tool_call / tool_result / debug / command → collapsible panel
 *
 * Large blocks render the first N lines with an expand toggle. Text blocks use
 * the {@link WorkerManager} to parse markdown off the main thread when the
 * content exceeds the inline threshold, preventing frame drops during scroll
 * with very long messages.
 */
@Component({
  selector: 'rv-message-block',
  templateUrl: './message-block.html',
  styleUrl: './message-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBlockComponent {
  private readonly workerManager = inject(WorkerManager);

  readonly block = input.required<MessageBlock>();
  readonly collapsedThreshold = input<number>(500);
  /** Content length above which markdown parsing goes to the worker. */
  readonly workerThreshold = input<number>(2_000);

  protected readonly expanded = signal(false);

  /** Rendered HTML for text blocks (markdown-parsed). */
  protected readonly renderedHtml = signal<string>('');

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
    // When the text block content changes, render markdown (worker or inline).
    effect(() => {
      const block = this.block();
      if (block.kind !== 'text') {
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

  private async renderMarkdown(content: string): Promise<void> {
    const html = await this.workerManager.parseMarkdown(content);
    // Only update if the block hasn't changed during async processing.
    if (this.block().content === content) {
      this.renderedHtml.set(html);
    }
  }
}
