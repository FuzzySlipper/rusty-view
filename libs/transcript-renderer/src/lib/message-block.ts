import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import type { MessageBlock } from '@rusty-view/chat-domain';

/**
 * Renders a single {@link MessageBlock} by kind.
 *
 * - text → full render
 * - tool_call / tool_result / debug / command → collapsible panel
 *
 * Large blocks render the first N lines with an expand toggle. This keeps
 * massive tool outputs or debug JSON from consuming the viewport.
 */
@Component({
  selector: 'rv-message-block',
  templateUrl: './message-block.html',
  styleUrl: './message-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBlockComponent {
  readonly block = input.required<MessageBlock>();
  readonly collapsedThreshold = input<number>(500);

  protected readonly expanded = signal(false);

  protected get isCollapsible(): boolean {
    return this.block().kind !== 'text';
  }

  protected get displayContent(): string {
    const content = this.block().content;
    if (!this.isCollapsible || this.expanded()) {
      return content;
    }
    const threshold = this.collapsedThreshold();
    if (content.length <= threshold) {
      return content;
    }
    return content.slice(0, threshold) + '…';
  }

  protected get isTruncated(): boolean {
    return (
      this.isCollapsible &&
      !this.expanded() &&
      this.block().content.length > this.collapsedThreshold()
    );
  }

  protected toggleExpand(): void {
    this.expanded.update((v) => !v);
  }
}
