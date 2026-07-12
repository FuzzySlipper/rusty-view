import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CdkVirtualScrollViewport,
  ScrollingModule,
} from '@angular/cdk/scrolling';
import { ScrollingModule as ExperimentalScrollingModule } from '@angular/cdk-experimental/scrolling';
import type { ChatMessage, MessageRole } from '@rusty-view/chat-domain';
import {
  branchBreadcrumbs as buildBranchBreadcrumbs,
  branchJumpTarget,
  searchConversationMessages,
  snapshotJumpTarget,
  type ConversationBranch,
  type ConversationBranchBreadcrumb,
  type ConversationNavigationTarget,
  type ConversationSearchFilters,
  type ConversationSnapshot,
  type MessageAlternateSlot,
} from '@rusty-view/chat-domain';

import { MessageItemComponent } from './message-item';
import type {
  MessageRevisionAction,
  MessageRevisionCapabilities,
} from './message-revision-controls';

const EMPTY_BLOCK_SET = new Set<string>();

/**
 * Virtualized transcript viewport.
 *
 * Renders 10k+ messages efficiently using Angular CDK virtual scroll with the
 * **autosize** strategy (`CdkAutoSizeVirtualScroll` from
 * `@angular/cdk-experimental/scrolling`). The autosize strategy measures real
 * item heights after rendering and uses an averaging estimator for unseen
 * items, so messages and expanded tool blocks lay out without overlap.
 *
 * Scroll behavior:
 * - Tail-follow: when the user is at the bottom, new content auto-scrolls.
 *   When the user scrolls up, tail-follow pauses (no fighting the user).
 * - Jump-to-message: set `targetMessageId` to scroll to a specific message.
 *   Uses an estimated pixel offset (based on average item size) since the
 *   autosize strategy does not support `scrollToIndex`.
 * - Scroll anchor preservation: when older history is prepended above the
 *   viewport (cursor-based replay), the viewport stays anchored to the message
 *   the user was looking at — no visible jump.
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
  imports: [ScrollingModule, ExperimentalScrollingModule, MessageItemComponent],
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

  /** Shows the generic current-conversation search toolbar. */
  readonly searchEnabled = input<boolean>(true);

  /** Branches available for optional breadcrumb navigation. */
  readonly branches = input<readonly ConversationBranch[]>([]);

  /** Active branch id used to derive breadcrumb navigation. */
  readonly activeBranchId = input<string | undefined>(undefined);

  /** Snapshot targets available for optional jump navigation. */
  readonly snapshots = input<readonly ConversationSnapshot[]>([]);

  /** Optional message alternate slots keyed by stable slot id. */
  readonly alternateSlots = input<readonly MessageAlternateSlot[]>([]);

  /** Supported revision actions for the host/backend. Unsupported buttons stay disabled. */
  readonly revisionCapabilities = input<MessageRevisionCapabilities>({});

  /** Emits when the user asks the transcript to jump to a tree target. */
  readonly navigationRequested = output<ConversationNavigationTarget>();
  readonly activeBranchSelected = output<string>();
  readonly revisionRequested = output<MessageRevisionAction>();

  /** Pixel threshold from bottom to consider "at bottom" for tail-follow. */
  private static readonly BOTTOM_THRESHOLD_PX = 80;

  /** Default estimated item height used for offset estimation when the autosize
   * strategy hasn't measured enough items yet. Matches the CSS-based minimum
   * height of a single-line message row. */
  private static readonly DEFAULT_ITEM_HEIGHT_PX = 50;

  protected readonly isAtBottom = signal(true);
  protected readonly showScrollToBottom = computed(
    () => this.renderMessages().length > 0 && !this.isAtBottom(),
  );

  /** Previous messages reference — used to detect prepends for anchor preservation. */
  private previousMessages: readonly ChatMessage[] = [];

  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly pendingSeekTimers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * The data actually rendered by `*cdkVirtualFor`. Distinct from the `messages`
   * input: CDK registers the rendered data length with its scroll strategy when
   * `*cdkVirtualForOf` first receives data. If that happens while the viewport is
   * still measured at 0 (messages preloaded before layout settles, or rendered
   * behind an `@if`), the strategy records a length of 0 and renders nothing
   * until the next data change. So we hold the data here and emit it only once
   * the viewport has a real size, then keep it in sync with the input.
   */
  protected readonly renderMessages = signal<readonly ChatMessage[]>([]);
  protected readonly searchQuery = signal('');
  protected readonly searchRole = signal<MessageRole | 'all'>('all');
  protected readonly searchDateFrom = signal('');
  protected readonly searchDateTo = signal('');
  protected readonly activeSearchIndex = signal(0);

  protected readonly branchBreadcrumbs = computed<
    readonly ConversationBranchBreadcrumb[]
  >(() => buildBranchBreadcrumbs(this.branches(), this.activeBranchId()));

  protected readonly snapshotTargets = computed(() =>
    this.snapshots()
      .map((snapshot) => snapshotJumpTarget(snapshot))
      .filter((target): target is ConversationNavigationTarget => {
        return target !== undefined;
      }),
  );

  protected readonly alternateSlotsByMessageId = computed(() => {
    const map = new Map<string, MessageAlternateSlot>();
    for (const slot of this.alternateSlots()) {
      map.set(slot.id, slot);
      map.set(slot.primary.message.id, slot);
      for (const alternate of slot.alternates) {
        map.set(alternate.message.id, slot);
      }
    }
    return map;
  });

  protected readonly hasNavigation = computed(() => {
    return (
      this.branchBreadcrumbs().length > 0 || this.snapshotTargets().length > 0
    );
  });

  protected readonly searchFilters = computed<ConversationSearchFilters>(() => {
    const role = this.searchRole();
    return {
      roles: role === 'all' ? [] : [role],
      dateFrom: this.searchDateFrom(),
      dateTo: this.searchDateTo(),
    };
  });

  protected readonly searchResults = computed(() => {
    if (!this.searchEnabled()) return [];
    return searchConversationMessages(
      this.renderMessages(),
      this.searchQuery(),
      this.searchFilters(),
    );
  });

  protected readonly activeSearchResult = computed(() => {
    const results = this.searchResults();
    if (results.length === 0) return undefined;
    return results[Math.min(this.activeSearchIndex(), results.length - 1)];
  });

  protected readonly matchedMessageIds = computed(() => {
    return new Set(this.searchResults().map((result) => result.messageId));
  });

  protected readonly activeSearchMessageId = computed(
    () => this.activeSearchResult()?.messageId,
  );

  protected readonly matchedBlockIdsByMessage = computed(() => {
    const matches = new Map<string, Set<string>>();
    for (const result of this.searchResults()) {
      const blocks = matches.get(result.messageId) ?? new Set<string>();
      blocks.add(result.blockId);
      matches.set(result.messageId, blocks);
    }
    return matches;
  });

  protected readonly searchStatus = computed(() => {
    const query = this.searchQuery().trim();
    if (query.length === 0) return 'Search';
    const count = this.searchResults().length;
    if (count === 0) return 'No results';
    return `${this.activeSearchIndex() + 1} / ${count}`;
  });

  protected readonly activeSearchSnippet = computed(() => {
    const result = this.activeSearchResult();
    if (result === undefined) return '';
    return result.snippet;
  });

  /** True once the viewport has been sized and has received the initial data. */
  private viewportReady = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const timer of this.pendingSeekTimers) {
        clearTimeout(timer);
      }
      this.pendingSeekTimers.clear();
    });

    // Keep the rendered data in sync with the input once the viewport is ready.
    effect(() => {
      const msgs = this.messages();
      if (this.viewportReady) {
        this.renderMessages.set(msgs);
      }
    });

    // Emit the initial data once the viewport has a non-zero size. A
    // ResizeObserver covers the case where the height lands after first render
    // (behind an `@if`, or a CSS-grid cell resolving from 0 → its real height).
    this.afterNextRender(() => {
      const host = this.viewport().elementRef.nativeElement;
      const emitWhenSized = () => {
        if (this.viewportReady || host.clientHeight === 0) return;
        this.viewportReady = true;
        this.renderMessages.set(this.messages());
      };
      emitWhenSized();
      if (!this.viewportReady && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => emitWhenSized());
        observer.observe(host);
        this.destroyRef.onDestroy(() => observer.disconnect());
      }
    });

    // Tail-follow + scroll anchor preservation: when the rendered messages
    // change, decide whether to scroll to bottom (tail-follow) or preserve the
    // anchor (prepend). Tracks `renderMessages` so it fires when the data is
    // first emitted to the viewport, not just when the input changes.
    effect(() => {
      const msgs = this.renderMessages();
      const prev = this.previousMessages;
      this.previousMessages = msgs;

      if (msgs.length === 0) return;

      const prependedCount = countPrependedMessages(prev, msgs);

      const replaced = messagesWereReplaced(prev, msgs);
      if (replaced) {
        this.isAtBottom.set(true);
      }

      if (prependedCount > 0 && !this.isAtBottom()) {
        // Older history was prepended above the viewport. Preserve the anchor
        // so the user doesn't see a jump.
        this.afterNextRender(() => {
          this.preserveScrollAnchor();
        });
        return;
      }

      if (this.tailFollow() && this.isAtBottom()) {
        this.afterNextRender(() => {
          this.scrollToBottom();
        });
      }
    });

    // Jump-to-message: when targetMessageId changes, scroll to that message.
    effect(() => {
      const targetId = this.targetMessageId();
      if (targetId === undefined) return;
      this.scrollToMessageId(targetId);
    });

    effect(() => {
      const results = this.searchResults();
      if (results.length === 0) {
        this.activeSearchIndex.set(0);
        return;
      }
      if (this.activeSearchIndex() >= results.length) {
        this.activeSearchIndex.set(results.length - 1);
      }
    });

    effect(() => {
      const result = this.activeSearchResult();
      if (result === undefined || this.searchQuery().trim().length === 0) {
        return;
      }
      this.scrollToMessageId(result.messageId);
    });
  }

  /** trackBy for *cdkVirtualFor: stable identity keeps streaming deltas from
   * re-creating views (only the changed message re-renders). */
  protected trackByMessageId(_index: number, message: ChatMessage): string {
    return message.id;
  }

  /** Called on viewport scroll to track whether the user is at the bottom. */
  protected onScroll(): void {
    const vp = this.viewport();
    const bottomOffset = vp.measureScrollOffset('bottom');
    this.isAtBottom.set(
      bottomOffset <= TranscriptViewportComponent.BOTTOM_THRESHOLD_PX,
    );
  }

  /** Scroll to the bottom of the transcript (latest message). */
  scrollToBottom(): void {
    this.cancelPendingSeeks();
    this.isAtBottom.set(true);
    this.scrollToBottomOffset();
    this.settleScrollToBottom(0);
  }

  private scrollToBottomOffset(): void {
    const vp = this.viewport();
    // Scroll to a very large offset — CDK clamps to the maximum scrollable
    // distance. This works with both fixed-size and autosize strategies.
    vp.scrollToOffset(Number.MAX_SAFE_INTEGER);
  }

  scrollToMessageId(messageId: string): void {
    this.cancelPendingSeeks();
    const msgs = this.currentMessagesForScroll();
    const index = msgs.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      this.afterNextRender(() => {
        this.seekMessageIntoView(messageId, index, 0);
      });
    }
  }

  private cancelPendingSeeks(): void {
    for (const timer of this.pendingSeekTimers) clearTimeout(timer);
    this.pendingSeekTimers.clear();
  }

  private afterNextRender(callback: () => void): void {
    afterNextRender(callback, { injector: this.injector });
  }

  protected updateSearchQuery(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.activeSearchIndex.set(0);
  }

  protected updateSearchRole(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.searchRole.set((target.value as MessageRole | 'all') || 'all');
    this.activeSearchIndex.set(0);
  }

  protected updateSearchDateFrom(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchDateFrom.set(target.value);
    this.activeSearchIndex.set(0);
  }

  protected updateSearchDateTo(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchDateTo.set(target.value);
    this.activeSearchIndex.set(0);
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
    this.searchRole.set('all');
    this.searchDateFrom.set('');
    this.searchDateTo.set('');
    this.activeSearchIndex.set(0);
  }

  protected previousSearchResult(): void {
    const count = this.searchResults().length;
    if (count === 0) return;
    this.activeSearchIndex.update((index) => (index - 1 + count) % count);
  }

  protected nextSearchResult(): void {
    const count = this.searchResults().length;
    if (count === 0) return;
    this.activeSearchIndex.update((index) => (index + 1) % count);
  }

  protected matchedBlocksFor(messageId: string): ReadonlySet<string> {
    return this.matchedBlockIdsByMessage().get(messageId) ?? EMPTY_BLOCK_SET;
  }

  protected jumpToBranch(crumb: ConversationBranchBreadcrumb): void {
    const target = crumb.target ?? branchJumpTarget(crumb.branch);
    if (target === undefined) return;

    this.activeBranchSelected.emit(crumb.branch.id);
    this.navigationRequested.emit(target);
    this.scrollToMessageId(target.messageId);
  }

  protected jumpToSnapshot(target: ConversationNavigationTarget): void {
    this.navigationRequested.emit(target);
    this.scrollToMessageId(target.messageId);
  }

  protected navigationLabel(
    target: ConversationNavigationTarget | undefined,
    fallback: string,
  ): string {
    return target?.label ?? fallback;
  }

  protected alternateSlotFor(
    messageId: string,
  ): MessageAlternateSlot | undefined {
    return this.alternateSlotsByMessageId().get(messageId);
  }

  protected onRevisionAction(action: MessageRevisionAction): void {
    this.revisionRequested.emit(action);
  }

  private seekMessageIntoView(
    messageId: string,
    index: number,
    attempt: number,
  ): void {
    if (this.viewportReady) {
      this.renderMessages.set(this.messages());
    }

    const rendered = this.findRenderedMessageElement(messageId);
    if (rendered !== null) {
      rendered.scrollIntoView({ block: 'nearest' });
      return;
    }

    this.scrollTowardIndex(index);

    if (attempt >= 12) return;
    const timer = setTimeout(() => {
      this.pendingSeekTimers.delete(timer);
      this.afterNextRender(() => {
        this.seekMessageIntoView(messageId, index, attempt + 1);
      });
    }, 50);
    this.pendingSeekTimers.add(timer);
  }

  private scrollTowardIndex(index: number): void {
    const vp = this.viewport();
    vp.checkViewportSize();

    const msgs = this.currentMessagesForScroll();
    if (msgs.length === 0) return;

    const clampedIndex = Math.max(0, Math.min(index, msgs.length - 1));
    if (clampedIndex === 0) {
      vp.scrollToOffset(0);
      return;
    }

    if (clampedIndex >= msgs.length - 1) {
      this.scrollToBottom();
      return;
    }

    const range = vp.getRenderedRange();
    const averageItemSize = this.averageRenderedItemSize();
    const currentOffset = vp.measureScrollOffset('top');

    let nextOffset: number;
    if (range.end > 0 && clampedIndex >= range.end) {
      nextOffset =
        currentOffset + (clampedIndex - range.end + 1) * averageItemSize;
    } else if (range.start > 0 && clampedIndex < range.start) {
      nextOffset =
        currentOffset - (range.start - clampedIndex + 1) * averageItemSize;
    } else {
      nextOffset = clampedIndex * averageItemSize;
    }

    vp.scrollToOffset(Math.max(0, nextOffset));
  }

  private currentMessagesForScroll(): readonly ChatMessage[] {
    return this.messages();
  }

  private averageRenderedItemSize(): number {
    const vp = this.viewport();
    const range = vp.getRenderedRange();
    const renderedCount = Math.max(0, range.end - range.start);
    if (renderedCount === 0) {
      return TranscriptViewportComponent.DEFAULT_ITEM_HEIGHT_PX;
    }

    const measured = vp.measureRenderedContentSize();
    if (measured <= 0) {
      return TranscriptViewportComponent.DEFAULT_ITEM_HEIGHT_PX;
    }

    return Math.max(
      TranscriptViewportComponent.DEFAULT_ITEM_HEIGHT_PX,
      measured / renderedCount,
    );
  }

  private findRenderedMessageElement(messageId: string): HTMLElement | null {
    const host = this.viewport().elementRef.nativeElement;
    const items = host.querySelectorAll<HTMLElement>(
      '[data-testid="transcript-item"]',
    );
    for (let i = 0; i < items.length; i++) {
      const item = items.item(i);
      if (item.dataset['messageId'] === messageId) return item;
    }
    return null;
  }

  private settleScrollToBottom(attempt: number): void {
    if (attempt >= 12) return;
    const timer = setTimeout(() => {
      this.pendingSeekTimers.delete(timer);
      this.afterNextRender(() => {
        const bottomOffset = this.viewport().measureScrollOffset('bottom');
        if (bottomOffset <= TranscriptViewportComponent.BOTTOM_THRESHOLD_PX) {
          this.isAtBottom.set(true);
          return;
        }
        this.scrollToBottomOffset();
        this.settleScrollToBottom(attempt + 1);
      });
    }, 50);
    this.pendingSeekTimers.add(timer);
  }

  /**
   * Preserve scroll anchor when older messages are prepended.
   *
   * The autosize strategy tracks real pixel positions, so we simply restore
   * the scroll offset from the top. The prepended messages shift all items
   * down, and restoring the offset keeps the viewport visually stable.
   */
  private preserveScrollAnchor(): void {
    const vp = this.viewport();

    // Record the scroll offset from the top before CDK recalculates.
    const scrollOffsetFromTop = vp.measureScrollOffset('top');

    // With autosize, just restore the pixel offset — the strategy has already
    // remeasured and repositioned items after the data change.
    vp.scrollToOffset(scrollOffsetFromTop);
  }
}

/** Detect a session/thread replacement so the new transcript opens at its tail. */
function messagesWereReplaced(
  previous: readonly ChatMessage[],
  current: readonly ChatMessage[],
): boolean {
  if (previous.length === 0 || current.length === 0) return false;
  const previousIds = new Set(previous.map((message) => message.id));
  return current.every((message) => !previousIds.has(message.id));
}

/**
 * Count how many new messages were prepended to the beginning of the array.
 *
 * Compares the old and new message arrays by message ID. If the new array
 * starts with messages not present at the start of the old array, those are
 * prepended items.
 */
function countPrependedMessages(
  prev: readonly ChatMessage[],
  current: readonly ChatMessage[],
): number {
  if (prev.length === 0) return 0;
  if (current.length <= prev.length) return 0;

  // Find where the old messages start in the new array.
  // The old first message ID should appear somewhere in the new array.
  const oldFirstId = prev[0]?.id;
  if (oldFirstId === undefined) return 0;

  // Check if the old first message is in the new array at a shifted position.
  const newIndex = current.findIndex((m) => m.id === oldFirstId);
  if (newIndex <= 0) return 0; // not found or still at position 0

  // Verify that the messages after the prepend match the old array.
  // This prevents false positives from reordering. We must check ALL of prev's
  // items — if current doesn't have enough items after the anchor, it's not a
  // clean prepend.
  for (let i = 0; i < prev.length; i++) {
    const oldMsg = prev[i];
    const newMsg = current[newIndex + i];
    if (oldMsg === undefined || newMsg === undefined) return 0;
    if (oldMsg.id !== newMsg.id) return 0; // not a clean prepend
  }

  return newIndex;
}
