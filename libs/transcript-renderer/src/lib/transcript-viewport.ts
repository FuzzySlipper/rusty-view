import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  viewChild,
} from '@angular/core';
import {
  CdkVirtualScrollViewport,
  ScrollingModule,
} from '@angular/cdk/scrolling';
import type { ChatMessage } from '@rusty-view/chat-domain';

import { MessageItemComponent } from './message-item';

/**
 * Virtualized transcript viewport.
 *
 * Renders 10k+ messages efficiently using Angular CDK virtual scroll with
 * auto-size (variable-height items). Only visible messages exist in the DOM.
 *
 * Scroll behavior:
 * - Tail-follow: when the user is at the bottom, new content auto-scrolls.
 *   When the user scrolls up, tail-follow pauses (no fighting the user).
 * - Jump-to-message: set `targetMessageId` to scroll to a specific message.
 *
 * Streaming-safe: each message is a separate OnPush component. When a text
 * delta updates one message, only that message's view re-renders — the virtual
 * scroll does not re-render non-visible or unchanged items.
 *
 * The chosen virtualizer (CDK) is hidden behind this component; the public API
 * is inputs/outputs only, so the virtualizer can be swapped without affecting
 * callers.
 */
@Component({
  selector: 'rv-transcript-viewport',
  imports: [ScrollingModule, MessageItemComponent],
  templateUrl: './transcript-viewport.html',
  styleUrl: './transcript-viewport.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranscriptViewportComponent {
  private readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  /** Messages to render (from ChatStore.projection().messages). */
  readonly messages = input.required<readonly ChatMessage[]>();

  /** When true (default), auto-scroll to bottom when new content arrives and
   * the user is already at the bottom. */
  readonly tailFollow = input<boolean>(true);

  /** Set to a message ID to jump-scroll to that message. */
  readonly targetMessageId = input<string | undefined>(undefined);

  /** Pixel threshold from bottom to consider "at bottom" for tail-follow. */
  private static readonly BOTTOM_THRESHOLD_PX = 80;

  private isAtBottom = true;

  constructor() {
    // Tail-follow: when messages change and user is at bottom, scroll down.
    effect(() => {
      const msgs = this.messages();
      if (this.tailFollow() && this.isAtBottom && msgs.length > 0) {
        // Defer scroll to after the DOM updates with the new content.
        afterNextRender(() => {
          this.scrollToBottom();
        });
      }
    });

    // Jump-to-message: when targetMessageId changes, scroll to that message.
    effect(() => {
      const targetId = this.targetMessageId();
      if (targetId === undefined) return;
      const msgs = this.messages();
      const index = msgs.findIndex((m) => m.id === targetId);
      if (index >= 0) {
        afterNextRender(() => {
          this.viewport().scrollToIndex(index, 'smooth');
        });
      }
    });
  }

  /** Called on viewport scroll to track whether the user is at the bottom. */
  protected onScroll(): void {
    const vp = this.viewport();
    const bottomOffset = vp.measureScrollOffset('bottom');
    this.isAtBottom =
      bottomOffset <= TranscriptViewportComponent.BOTTOM_THRESHOLD_PX;
  }

  /** Scroll to the bottom of the transcript (latest message). */
  scrollToBottom(): void {
    const vp = this.viewport();
    const count = this.messages().length;
    if (count > 0) {
      vp.scrollToIndex(count - 1);
    }
  }
}
