import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  HostListener,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  CdkVirtualScrollViewport,
  ScrollingModule,
} from '@angular/cdk/scrolling';
import {
  CdkAutoSizeVirtualScroll,
  ScrollingModule as ExperimentalScrollingModule,
} from '@angular/cdk-experimental/scrolling';
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
import {
  DEFAULT_TRANSCRIPT_ACTIVITY_VISIBILITY,
  visibleTranscriptBlocks,
  type TranscriptActivityVisibility,
} from './activity-visibility';
import type {
  MessageRevisionAction,
  MessageRevisionCapabilities,
} from './message-revision-controls';
import {
  assessTranscriptGeometry,
  transcriptGeometryPresentationKey,
  type TranscriptGeometryMeasurement,
} from './transcript-geometry';

const EMPTY_BLOCK_SET = new Set<string>();

export interface TranscriptVirtualRow {
  readonly id: string;
  readonly messages: readonly ChatMessage[];
}

export type TranscriptScrollWriteReason =
  | 'explicit-latest'
  | 'tail-follow-render'
  | 'tail-follow-settle'
  | 'tail-geometry-mutation'
  | 'tail-geometry-rendered-resize'
  | 'tail-geometry-estimated-resize'
  | 'tail-geometry-frame'
  | 'estimator-reset'
  | 'paused-offset-hold'
  | 'seek-rendered-message'
  | 'seek-first-row'
  | 'seek-estimated-row'
  | 'seek-tail'
  | 'geometry-reconcile-streaming'
  | 'geometry-reconcile-settled'
  | 'prepend-anchor-restore';

export interface TranscriptScrollWriteTrace {
  readonly sequence: number;
  readonly frame: number;
  readonly timestampMs: number;
  readonly reason: TranscriptScrollWriteReason;
  readonly requestedOffset: number | null;
  readonly targetMessageId: string | null;
  readonly offsetBefore: number;
  readonly offsetAfter: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly followingTail: boolean;
  readonly atBottom: boolean;
  readonly transcriptKey: string | null;
  readonly authority: 'application' | 'user-input';
}

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
  private readonly cdkViewport = viewChild(CdkVirtualScrollViewport);
  private readonly cdkAutoSize = viewChild(CdkAutoSizeVirtualScroll);
  private readonly fullDomViewport =
    viewChild<ElementRef<HTMLElement>>('fullDomViewport');

  /** Temporary bake-off switch. It is deliberately URL-only and is not part
   * of the public component API or the user-facing Options surface. */
  private readonly prototypeRenderer =
    typeof location === 'undefined'
      ? 'current'
      : (new URLSearchParams(location.search).get('__rvTranscriptRenderer') ??
        'current');
  protected readonly fullDomPrototypeEnabled =
    this.prototypeRenderer === 'full-dom' ||
    this.prototypeRenderer === 'owned-window';
  protected readonly ownedWindowPrototypeEnabled =
    this.prototypeRenderer === 'owned-window';
  protected readonly prototypeRendererLabel = this.ownedWindowPrototypeEnabled
    ? 'owned-window'
    : 'full-dom';

  /** Messages to render (from ChatStore.projection().messages). */
  readonly messages = input.required<readonly ChatMessage[]>();

  /** Stable identity for the selected conversation. Projection row IDs may be
   * replaced within one conversation and must not be mistaken for a switch. */
  readonly transcriptKey = input<string | undefined>(undefined);

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

  /** Whether generic message actions are rendered. Variant navigation remains available. */
  readonly showRevisionActions = input<boolean>(true);

  /** Whether reasoning blocks should open when first rendered. */
  readonly autoExpandReasoning = input<boolean>(false);

  /** Product-agnostic visibility for inline reasoning and tool activity. */
  readonly activityVisibility = input<TranscriptActivityVisibility>(
    DEFAULT_TRANSCRIPT_ACTIVITY_VISIBILITY,
  );

  /** Emits when the user asks the transcript to jump to a tree target. */
  readonly navigationRequested = output<ConversationNavigationTarget>();
  readonly activeBranchSelected = output<string>();
  readonly revisionRequested = output<MessageRevisionAction>();

  /** Pixel threshold from bottom to consider "at bottom" for tail-follow. */
  private static readonly BOTTOM_THRESHOLD_PX = 80;

  /**
   * CDK autosize revises its estimated content size while a variable-height
   * tail row grows. Rewriting the strategy's total size during that window can
   * fight the next measurement and produce visible reverse jumps, so only run
   * the stale-spacer repair after the tail has been quiet for this long.
   */
  private static readonly TAIL_GEOMETRY_QUIET_MS = 150;

  /**
   * A session switch can replace an expanded multi-thousand-pixel reasoning row
   * with a short tail. Experimental autosize may need several observer/render
   * cycles to discard the retained average, so bound settlement by elapsed time
   * rather than an unrealistically small fixed number of passes.
   */
  private static readonly TAIL_SETTLE_MAX_MS = 2_500;

  /** Default estimated item height used for offset estimation when the autosize
   * strategy hasn't measured enough items yet. Matches the CSS-based minimum
   * height of a single-line message row. */
  private static readonly DEFAULT_ITEM_HEIGHT_PX = 50;
  private static readonly OWNED_WINDOW_ROW_COUNT = 64;
  private static readonly OWNED_WINDOW_ROW_ESTIMATE_PX = 120;
  private static readonly OWNED_WINDOW_ADMISSION_FRAME_BUDGET = 8;

  protected readonly isAtBottom = signal(true);
  protected readonly followingTail = signal(true);
  protected readonly showScrollToBottom = computed(
    () =>
      this.renderMessages().length > 0 &&
      (!this.isAtBottom() || !this.followingTail()),
  );

  /** Previous messages reference — used to detect prepends for anchor preservation. */
  private previousMessages: readonly ChatMessage[] = [];

  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly pendingSeekTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly pausedScrollHoldTimers = new Set<
    ReturnType<typeof setTimeout>
  >();
  private tailSettleTimer: ReturnType<typeof setTimeout> | undefined;
  private tailFollowGeneration = 0;
  private pausedScrollHoldGeneration = 0;
  private tailFollowRenderPending = false;
  private tailGeometryChangedAt = Number.NEGATIVE_INFINITY;
  private renderedContentHeight: number | undefined;
  private estimatedTotalHeight: number | undefined;
  private geometryPresentationKey: string | undefined;
  private previousTranscriptKey: string | undefined;
  private pendingPausedScrollOffset: number | undefined;
  private resumeFollowOnUserScrollToTail = false;
  private scrollbarDragActive = false;
  private touchScrollActive = false;
  private transcriptTransitionFrame: number | undefined;
  private tailGeometryFrame: number | undefined;
  private fullDomFollowFrame: number | undefined;
  private ownedWindowEndFrame: number | undefined;
  private ownedWindowEndGeneration = 0;
  private ownedWindowEndAdmissionPending = false;
  private fullDomRenderFollowPending = false;
  private scrollDiagnosticsEnabled = false;
  private scrollWriteSequence = 0;
  private scrollWriteFrame = 0;
  private scrollWriteFrameOpen = false;
  private readonly scrollWriteTrace: TranscriptScrollWriteTrace[] = [];

  private static readonly MAX_SCROLL_TRACE_ENTRIES = 500;

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
  protected readonly renderRows = signal<readonly TranscriptVirtualRow[]>([]);
  private readonly ownedWindowStart = signal(0);
  protected readonly prototypeRenderRows = computed(() => {
    const rows = this.renderRows();
    if (!this.ownedWindowPrototypeEnabled) return rows;
    const start = Math.min(this.ownedWindowStart(), rows.length);
    return rows.slice(
      start,
      Math.min(
        rows.length,
        start + TranscriptViewportComponent.OWNED_WINDOW_ROW_COUNT,
      ),
    );
  });
  protected readonly ownedWindowTopSpacerPx = computed(() =>
    this.ownedWindowPrototypeEnabled
      ? this.ownedWindowStart() *
        TranscriptViewportComponent.OWNED_WINDOW_ROW_ESTIMATE_PX
      : 0,
  );
  protected readonly ownedWindowBottomSpacerPx = computed(() => {
    if (!this.ownedWindowPrototypeEnabled) return 0;
    const remaining = Math.max(
      0,
      this.renderRows().length -
        this.ownedWindowStart() -
        TranscriptViewportComponent.OWNED_WINDOW_ROW_COUNT,
    );
    return remaining * TranscriptViewportComponent.OWNED_WINDOW_ROW_ESTIMATE_PX;
  });
  protected readonly transcriptTransitioning = signal(false);
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
      this.searchableMessages(),
      this.searchQuery(),
      this.searchFilters(),
    );
  });

  private readonly searchableMessages = computed(() => {
    const visibility = this.activityVisibility();
    return this.renderMessages().map((message) => {
      const blocks = visibleTranscriptBlocks(message, visibility);
      return blocks === message.blocks ? message : { ...message, blocks };
    });
  });

  protected readonly activeSearchResult = computed(() => {
    const results = this.searchResults();
    if (results.length === 0) return undefined;
    return results[Math.min(this.activeSearchIndex(), results.length - 1)];
  });

  private readonly activeSearchSeekKey = computed(() =>
    transcriptSearchSeekKey(this.searchQuery(), this.activeSearchResult()),
  );

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
      this.cancelPausedScrollHold();
      if (this.tailSettleTimer !== undefined) {
        clearTimeout(this.tailSettleTimer);
      }
      if (this.transcriptTransitionFrame !== undefined) {
        cancelAnimationFrame(this.transcriptTransitionFrame);
      }
      if (this.tailGeometryFrame !== undefined) {
        cancelAnimationFrame(this.tailGeometryFrame);
      }
      if (this.fullDomFollowFrame !== undefined) {
        cancelAnimationFrame(this.fullDomFollowFrame);
      }
      if (this.ownedWindowEndFrame !== undefined) {
        cancelAnimationFrame(this.ownedWindowEndFrame);
      }
    });

    // Conversation identity is supplied by the composition layer. Do not
    // infer it from projected row IDs: Codex can replace every row while
    // reconciling one thread, and that must not seize scrolling from the user.
    effect(() => {
      const key = this.transcriptKey();
      const previousKey = this.previousTranscriptKey;
      this.previousTranscriptKey = key;
      if (
        previousKey === undefined ||
        key === undefined ||
        previousKey === key
      ) {
        return;
      }

      this.transcriptTransitioning.set(true);
      this.previousMessages = [];
      this.isAtBottom.set(true);
      this.resumeTailFollow();
      if (this.viewportReady) {
        if (this.fullDomPrototypeEnabled) {
          const messages = this.messages();
          if (messages.length > 0) {
            this.setRenderedMessages(messages);
            this.requestFullDomTailPlacement('tail-follow-render', true);
            this.afterNextRender(() => this.transcriptTransitioning.set(false));
          }
          return;
        }
        // Install both the replacement data and a valid tail range in the same
        // signal turn. If CDK first observes the new data through the old
        // transcript's range, a short/very-tall predecessor can leave the
        // range outside the replacement and produce a blank frame.
        const messages = this.messages();
        const rows = this.setRenderedMessages(messages);
        this.viewport().setRenderedRange({
          start: Math.max(0, rows.length - 20),
          end: rows.length,
        });
        this.afterNextRender(() => {
          this.resetAutoSizeEstimator();
          this.finishTranscriptTransitionWhenRendered();
        });
      } else {
        this.transcriptTransitioning.set(false);
      }
    });

    // Keep the rendered data in sync with the input once the viewport is ready.
    effect(() => {
      const msgs = this.messages();
      if (this.viewportReady) {
        // Keep the identity guard ahead of the paused-anchor layout read. Idle
        // polling commonly supplies fresh but presentation-identical objects;
        // those ticks must not synchronously measure or touch CDK at all.
        if (!transcriptPresentationChanged(this.renderMessages(), msgs)) {
          return;
        }
        if (this.fullDomPrototypeEnabled) {
          if (this.transcriptTransitioning() && msgs.length === 0) return;
          this.setRenderedMessages(msgs, true);
          if (this.transcriptTransitioning()) {
            this.requestFullDomTailPlacement('tail-follow-render', true);
            this.afterNextRender(() => this.transcriptTransitioning.set(false));
          }
          return;
        }
        this.pendingPausedScrollOffset = !this.followingTail()
          ? this.viewport().measureScrollOffset('top')
          : undefined;
        this.setRenderedMessages(msgs, true);
      }
    });

    // Keep presentation-driven height invalidation in one explicit model.
    // Actual DOM height remains authoritative (the wrapper ResizeObserver
    // below also covers Markdown, HTML, custom renderers, and future content),
    // while this key makes settings that affect unrendered rows visible to the
    // virtualizer before those rows materialize.
    effect(() => {
      const visibility = this.activityVisibility();
      const key = transcriptGeometryPresentationKey({
        autoExpandReasoning: this.autoExpandReasoning(),
        reasoningVisible: visibility.reasoning,
        toolsVisible: visibility.tools,
        revisionActionsVisible: this.showRevisionActions(),
        alternateSlotCount: this.alternateSlots().length,
      });
      const changed =
        this.geometryPresentationKey !== undefined &&
        this.geometryPresentationKey !== key;
      this.geometryPresentationKey = key;
      if (!changed || !this.viewportReady) return;

      this.noteTailGeometryChange();
      if (this.fullDomPrototypeEnabled) {
        if (this.tailFollow() && this.followingTail()) {
          this.requestFullDomTailPlacement('tail-follow-render', true);
        }
        return;
      }
      this.afterNextRender(() => {
        this.viewport().checkViewportSize();
        if (this.tailFollow() && this.followingTail()) {
          this.requestTailFollow();
        }
      });
    });

    // Emit the initial data once the viewport has a non-zero size. A
    // ResizeObserver covers both initial sizing (behind an `@if`, or a CSS-grid
    // cell resolving from 0 → its real height) and later layout changes. A ready
    // viewport can move away from the tail when it shrinks without emitting a
    // scroll event, so every resize also refreshes CDK's measurements and the
    // tail-control state.
    this.afterNextRender(() => {
      const host = this.scrollHost();
      const emitWhenSized = () => {
        if (!this.viewportReady && host.clientHeight > 0) {
          this.viewportReady = true;
          this.setRenderedMessages(this.messages());
        }
        if (this.viewportReady) {
          if (this.fullDomPrototypeEnabled) {
            if (this.followingTail()) {
              this.requestFullDomTailPlacement('tail-follow-render', true);
            }
          } else {
            this.viewport().checkViewportSize();
          }
          this.recomputeBottomState();
        }
      };
      emitWhenSized();
      if (typeof ResizeObserver !== 'undefined') {
        const viewportObserver = new ResizeObserver(() => emitWhenSized());
        viewportObserver.observe(host);

        if (this.fullDomPrototypeEnabled) {
          const content = host.querySelector<HTMLElement>(
            '.rv-transcript__full-content',
          );
          const contentObserver = new ResizeObserver(() => {
            if (this.tailFollow() && this.followingTail()) {
              this.requestFullDomTailPlacement('tail-geometry-rendered-resize');
            }
          });
          if (content !== null) contentObserver.observe(content);
          this.destroyRef.onDestroy(() => {
            viewportObserver.disconnect();
            contentObserver.disconnect();
          });
          return;
        }

        const contentWrapper = host.querySelector<HTMLElement>(
          '.cdk-virtual-scroll-content-wrapper',
        );
        const contentObserver = new ResizeObserver((entries) => {
          const height = entries.at(-1)?.contentRect.height;
          if (height !== undefined) this.onRenderedContentResize(height);
        });
        if (contentWrapper !== null) contentObserver.observe(contentWrapper);

        const spacer = host.querySelector<HTMLElement>(
          '.cdk-virtual-scroll-spacer',
        );
        const spacerObserver = new ResizeObserver((entries) => {
          const height = entries.at(-1)?.contentRect.height;
          if (height !== undefined) this.onEstimatedTotalResize(height);
        });
        if (spacer !== null) spacerObserver.observe(spacer);

        this.destroyRef.onDestroy(() => {
          viewportObserver.disconnect();
          contentObserver.disconnect();
          spacerObserver.disconnect();
        });
      }
      if (this.fullDomPrototypeEnabled) return;
      if (typeof MutationObserver !== 'undefined') {
        const contentWrapper = host.querySelector<HTMLElement>(
          '.cdk-virtual-scroll-content-wrapper',
        );
        const spacer = host.querySelector<HTMLElement>(
          '.cdk-virtual-scroll-spacer',
        );
        const geometryObserver = new MutationObserver(() => {
          if (
            !this.viewportReady ||
            !this.tailFollow() ||
            !this.followingTail() ||
            !this.tailIsStreaming()
          ) {
            return;
          }
          this.followMaterializedTailGeometryNow('tail-geometry-mutation');
          this.scheduleMaterializedTailGeometryFollow();
        });
        if (contentWrapper !== null) {
          geometryObserver.observe(contentWrapper, {
            attributes: true,
            attributeFilter: ['style'],
            characterData: true,
            childList: true,
            subtree: true,
          });
        }
        if (spacer !== null) {
          geometryObserver.observe(spacer, {
            attributes: true,
            attributeFilter: ['style'],
          });
        }
        this.destroyRef.onDestroy(() => geometryObserver.disconnect());
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
      const tailChanged = transcriptTailChanged(prev, msgs);
      const projectionChanged = transcriptPresentationChanged(prev, msgs);
      const offsetBeforeProjection = this.pendingPausedScrollOffset;
      this.pendingPausedScrollOffset = undefined;
      const pausedScrollOffset =
        projectionChanged &&
        prependedCount === 0 &&
        !this.followingTail() &&
        !this.scrollbarDragActive &&
        !this.touchScrollActive
          ? offsetBeforeProjection
          : undefined;
      if (tailChanged) {
        this.noteTailGeometryChange();
      }

      // Keep a compatibility fallback for standalone consumers that have not
      // supplied a transcript key. The app shell always supplies one.
      const replaced =
        this.transcriptKey() === undefined && messagesWereReplaced(prev, msgs);
      if (this.fullDomPrototypeEnabled) {
        if (replaced) {
          this.isAtBottom.set(true);
          this.resumeTailFollow();
        }
        if (tailChanged && this.tailFollow() && this.followingTail()) {
          this.requestFullDomTailPlacement('tail-follow-render', true);
        }
        // Native browser anchoring exclusively owns paused growth and prepend.
        return;
      }
      if (replaced) {
        this.isAtBottom.set(true);
        this.resumeTailFollow();
        this.afterNextRender(() => this.resetAutoSizeEstimator());
      }

      if (prependedCount > 0 && !this.followingTail()) {
        // Older history was prepended above the viewport. Preserve the anchor
        // so the user doesn't see a jump.
        this.afterNextRender(() => {
          this.preserveScrollAnchor();
        });
        return;
      }

      if (pausedScrollOffset !== undefined) {
        this.holdPausedScrollOffset(pausedScrollOffset);
        return;
      }

      if (tailChanged && this.tailFollow() && this.followingTail()) {
        this.requestTailFollow();
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
      const seekKey = this.activeSearchSeekKey();
      if (seekKey === undefined) {
        this.cancelPendingSeeks();
        return;
      }
      const result = untracked(() => this.activeSearchResult());
      if (result?.id !== seekKey) return;
      this.scrollToMessageId(result.messageId);
    });
  }

  private viewport(): CdkVirtualScrollViewport {
    const viewport = this.cdkViewport();
    if (viewport === undefined) {
      throw new Error('CDK viewport is unavailable in the full-DOM prototype');
    }
    return viewport;
  }

  private autoSize(): CdkAutoSizeVirtualScroll {
    const autoSize = this.cdkAutoSize();
    if (autoSize === undefined) {
      throw new Error('CDK autosize is unavailable in the full-DOM prototype');
    }
    return autoSize;
  }

  private scrollHost(): HTMLElement {
    const fullDomHost = this.fullDomViewport()?.nativeElement;
    if (this.fullDomPrototypeEnabled && fullDomHost !== undefined) {
      return fullDomHost;
    }
    return this.viewport().elementRef.nativeElement;
  }

  /** Install stable message rows into CDK's autosize virtualizer. */
  private setRenderedMessages(
    messages: readonly ChatMessage[],
    presentationChanged?: boolean,
  ): readonly TranscriptVirtualRow[] {
    const previousMessages = this.renderMessages();
    const previousRows = this.renderRows();
    const previousWindowFirstId = this.ownedWindowPrototypeEnabled
      ? previousRows[this.ownedWindowStart()]?.id
      : undefined;
    const changed =
      presentationChanged ??
      transcriptPresentationChanged(previousMessages, messages);
    if (!changed) {
      return this.renderRows();
    }
    const rows = projectTranscriptVirtualRows(messages, previousRows);
    this.renderMessages.set(messages);
    this.renderRows.set(rows);
    if (this.ownedWindowPrototypeEnabled) {
      const retainedStart =
        previousWindowFirstId === undefined
          ? -1
          : rows.findIndex((row) => row.id === previousWindowFirstId);
      if (this.followingTail() || this.transcriptTransitioning()) {
        this.placeOwnedWindowAtTail();
      } else if (retainedStart >= 0) {
        this.ownedWindowStart.set(retainedStart);
      } else {
        // Codex reconciliation can replace every projected row id without a
        // conversation switch. Preserve the paused logical slice by index in
        // that case; never seize the tail merely because identities changed.
        this.ownedWindowStart.set(
          Math.min(
            this.ownedWindowStart(),
            Math.max(
              0,
              rows.length - TranscriptViewportComponent.OWNED_WINDOW_ROW_COUNT,
            ),
          ),
        );
      }
    }
    return rows;
  }

  private placeOwnedWindowAtTail(): void {
    const start = Math.max(
      0,
      this.renderRows().length -
        TranscriptViewportComponent.OWNED_WINDOW_ROW_COUNT,
    );
    this.ownedWindowStart.set(start);
  }

  private placeOwnedWindowAround(index: number): void {
    const rows = this.renderRows();
    const half = Math.floor(
      TranscriptViewportComponent.OWNED_WINDOW_ROW_COUNT / 2,
    );
    const maxStart = Math.max(
      0,
      rows.length - TranscriptViewportComponent.OWNED_WINDOW_ROW_COUNT,
    );
    this.ownedWindowStart.set(Math.max(0, Math.min(maxStart, index - half)));
  }

  private syncOwnedWindowToScrollPosition(): void {
    if (
      !this.ownedWindowPrototypeEnabled ||
      this.ownedWindowEndAdmissionPending ||
      this.renderRows().length === 0
    ) {
      return;
    }
    const host = this.scrollHost();
    const maximum = Math.max(1, host.scrollHeight - host.clientHeight);
    const fraction = Math.max(0, Math.min(1, host.scrollTop / maximum));
    const index = Math.round(fraction * (this.renderRows().length - 1));
    const currentStart = this.ownedWindowStart();
    const currentEnd =
      currentStart + TranscriptViewportComponent.OWNED_WINDOW_ROW_COUNT;
    if (index < currentStart + 16 || index >= currentEnd - 16) {
      this.placeOwnedWindowAround(index);
    }
  }

  /** Stable CDK identity prevents a growing Codex turn from recreating its row. */
  protected trackByVirtualRowId(
    _index: number,
    row: TranscriptVirtualRow,
  ): string {
    return row.id;
  }

  /** Called on viewport scroll to track whether the user is at the bottom. */
  protected onScroll(): void {
    this.syncOwnedWindowToScrollPosition();
    this.recomputeBottomState();
    if (
      this.resumeFollowOnUserScrollToTail &&
      !this.scrollbarDragActive &&
      this.bottomOffset() <= 1
    ) {
      this.resumeTailFollow();
    }
  }

  /** Wheel direction records explicit user intent independently from the
   * broader visual "near bottom" threshold. */
  protected onWheel(event: WheelEvent): void {
    this.cancelOwnedWindowEndAdmission();
    this.cancelPausedScrollHold();
    if (event.deltaY < 0) {
      this.resumeFollowOnUserScrollToTail = false;
      this.pauseTailFollow();
    } else if (event.deltaY > 0 && !this.followingTail()) {
      this.resumeFollowOnUserScrollToTail = true;
    }
  }

  /** Touch scrolling always begins under user control. */
  protected onTouchStart(): void {
    this.cancelOwnedWindowEndAdmission();
    this.cancelPausedScrollHold();
    this.touchScrollActive = true;
    this.resumeFollowOnUserScrollToTail = false;
    this.pauseTailFollow();
  }

  protected onTouchEnd(): void {
    this.touchScrollActive = false;
    this.resumeFollowIfUserReachedTail();
  }

  /** Stop pending tail settlement before a native scrollbar drag begins. */
  protected onPointerDown(event: PointerEvent): void {
    const host = this.scrollHost();
    const bounds = host.getBoundingClientRect();
    const scrollbarWidth = Math.max(16, host.offsetWidth - host.clientWidth);
    if (event.clientX >= bounds.right - scrollbarWidth) {
      this.cancelOwnedWindowEndAdmission();
      this.cancelPausedScrollHold();
      this.scrollbarDragActive = true;
      this.resumeFollowOnUserScrollToTail = false;
      this.pauseTailFollow();
    }
  }

  protected onKeyboardScroll(event: KeyboardEvent): void {
    if (!this.fullDomPrototypeEnabled) return;
    this.cancelOwnedWindowEndAdmission();
    const host = this.scrollHost();
    let target: number | undefined;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = host.scrollHeight;
    if (event.key === 'PageUp') {
      target = Math.max(0, host.scrollTop - host.clientHeight);
    }
    if (event.key === 'PageDown') {
      target = Math.min(host.scrollHeight, host.scrollTop + host.clientHeight);
    }
    if (target === undefined) return;
    event.preventDefault();
    this.pauseTailFollow();
    if (event.key === 'End' && this.ownedWindowPrototypeEnabled) {
      const generation = this.ownedWindowEndGeneration;
      this.ownedWindowEndAdmissionPending = true;
      this.placeOwnedWindowAtTail();
      this.afterNextRender(() => {
        this.scrollOwnedWindowToEndAfterAdmission(host, generation, 0, 0);
      });
      return;
    }
    this.writeScrollPosition(
      'seek-rendered-message',
      target,
      null,
      () => {
        host.scrollTop = target;
      },
      'user-input',
    );
    this.recomputeBottomState();
  }

  /** Wait for the tail window to be painted before performing the one
   * user-authority End write. Writing against the outgoing window lets native
   * anchoring restore its old position after the new spacer geometry arrives. */
  private scrollOwnedWindowToEndAfterAdmission(
    host: HTMLElement,
    generation: number,
    admittedFrames: number,
    attempt: number,
  ): void {
    this.ownedWindowEndFrame = requestAnimationFrame(() => {
      this.ownedWindowEndFrame = undefined;
      if (generation !== this.ownedWindowEndGeneration) return;

      const expectedTailId = this.renderRows().at(-1)?.id;
      const renderedTailId = Array.from(
        host.querySelectorAll<HTMLElement>('[data-virtual-row-id]'),
      ).at(-1)?.dataset['virtualRowId'];
      const nextAdmittedFrames =
        expectedTailId !== undefined && renderedTailId === expectedTailId
          ? admittedFrames + 1
          : 0;
      if (
        nextAdmittedFrames < 2 &&
        attempt + 1 <
          TranscriptViewportComponent.OWNED_WINDOW_ADMISSION_FRAME_BUDGET
      ) {
        this.scrollOwnedWindowToEndAfterAdmission(
          host,
          generation,
          nextAdmittedFrames,
          attempt + 1,
        );
        return;
      }
      if (nextAdmittedFrames < 2) {
        this.ownedWindowEndAdmissionPending = false;
        return;
      }

      this.writeScrollPosition(
        'seek-rendered-message',
        host.scrollHeight,
        null,
        () => {
          host.scrollTop = host.scrollHeight;
        },
        'user-input',
      );
      this.ownedWindowEndAdmissionPending = false;
      this.recomputeBottomState();
    });
  }

  private cancelOwnedWindowEndAdmission(): void {
    this.ownedWindowEndGeneration += 1;
    this.ownedWindowEndAdmissionPending = false;
    if (this.ownedWindowEndFrame === undefined) return;
    cancelAnimationFrame(this.ownedWindowEndFrame);
    this.ownedWindowEndFrame = undefined;
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  protected onPointerUp(): void {
    if (!this.scrollbarDragActive) return;
    this.scrollbarDragActive = false;
    this.resumeFollowIfUserReachedTail();
  }

  private resumeFollowIfUserReachedTail(): void {
    this.recomputeBottomState();
    if (this.bottomOffset() <= 1) {
      this.resumeTailFollow();
    }
  }

  private recomputeBottomState(): void {
    this.isAtBottom.set(
      this.bottomOffset() <= TranscriptViewportComponent.BOTTOM_THRESHOLD_PX,
    );
  }

  private bottomOffset(): number {
    const host = this.scrollHost();
    return Math.max(0, host.scrollHeight - host.scrollTop - host.clientHeight);
  }

  /** Enable the bounded, local-only write trace used by browser certification. */
  setScrollDiagnosticsEnabled(enabled: boolean): void {
    this.scrollDiagnosticsEnabled = enabled;
    if (enabled) this.clearScrollWriteTrace();
  }

  clearScrollWriteTrace(): void {
    this.scrollWriteTrace.length = 0;
    this.scrollWriteSequence = 0;
  }

  getScrollWriteTrace(): readonly TranscriptScrollWriteTrace[] {
    return this.scrollWriteTrace.map((entry) => ({ ...entry }));
  }

  private writeScrollPosition(
    reason: TranscriptScrollWriteReason,
    requestedOffset: number | null,
    targetMessageId: string | null,
    write: () => void,
    authority: 'application' | 'user-input' = 'application',
  ): void {
    if (!this.scrollDiagnosticsEnabled) {
      write();
      return;
    }

    const host = this.scrollHost();
    const offsetBefore = host.scrollTop;
    const timestampMs =
      typeof performance === 'undefined' ? Date.now() : performance.now();
    if (!this.scrollWriteFrameOpen) {
      this.scrollWriteFrame += 1;
      this.scrollWriteFrameOpen = true;
      requestAnimationFrame(() => {
        this.scrollWriteFrameOpen = false;
      });
    }

    write();

    const offsetAfter = host.scrollTop;
    const bottomOffset = Math.max(
      0,
      host.scrollHeight - offsetAfter - host.clientHeight,
    );
    this.scrollWriteTrace.push({
      sequence: ++this.scrollWriteSequence,
      frame: this.scrollWriteFrame,
      timestampMs,
      reason,
      requestedOffset,
      targetMessageId,
      offsetBefore,
      offsetAfter,
      scrollHeight: host.scrollHeight,
      clientHeight: host.clientHeight,
      followingTail: this.followingTail(),
      atBottom: bottomOffset <= TranscriptViewportComponent.BOTTOM_THRESHOLD_PX,
      transcriptKey: this.transcriptKey() ?? null,
      authority,
    });
    if (
      this.scrollWriteTrace.length >
      TranscriptViewportComponent.MAX_SCROLL_TRACE_ENTRIES
    ) {
      this.scrollWriteTrace.splice(
        0,
        this.scrollWriteTrace.length -
          TranscriptViewportComponent.MAX_SCROLL_TRACE_ENTRIES,
      );
    }
  }

  /** Scroll to the bottom of the transcript (latest message). */
  scrollToBottom(): void {
    this.scrollToBottomFor('explicit-latest');
  }

  private scrollToBottomFor(reason: TranscriptScrollWriteReason): void {
    this.cancelPendingSeeks();
    this.isAtBottom.set(true);
    this.resumeTailFollow();
    const generation = this.tailFollowGeneration;
    if (this.fullDomPrototypeEnabled) {
      this.requestFullDomTailPlacement(reason);
      return;
    }
    this.scrollToBottomOffset(reason);
    this.settleScrollToBottom(0, generation);
  }

  private requestTailFollow(): void {
    if (this.fullDomPrototypeEnabled) {
      this.requestFullDomTailPlacement('tail-follow-render', true);
      return;
    }
    if (this.tailFollowRenderPending) return;
    const generation = this.tailFollowGeneration;
    this.tailFollowRenderPending = true;
    this.afterNextRender(() => {
      if (generation !== this.tailFollowGeneration) return;
      this.tailFollowRenderPending = false;
      if (!this.tailFollow() || !this.followingTail()) return;
      // A newly materialized streaming row can inherit CDK autosize's
      // provisional spacer extent until its first ResizeObserver pass. Repair
      // that disagreement in Angular's render completion callback so the
      // browser never paints a bottom-pinned blank frame in between.
      if (this.tailIsStreaming()) {
        if (this.isTailMaterialized()) {
          this.followMaterializedTailGeometryNow('tail-follow-render');
        }
        this.scheduleMaterializedTailGeometryFollow();
      }
      if (this.viewport().measureScrollOffset('bottom') > 2) {
        this.scrollToBottomOffset('tail-follow-render');
      }
      this.settleScrollToBottom(0, generation);
    });
  }

  /** Option B has one scroll authority: a single write coalesced into the next
   * animation frame. ResizeObserver and Angular projection changes may both
   * request it, but neither can create a second writer or a settlement loop. */
  private requestFullDomTailPlacement(
    reason: TranscriptScrollWriteReason,
    afterRender = false,
  ): void {
    if (this.ownedWindowPrototypeEnabled) this.placeOwnedWindowAtTail();
    if (afterRender) {
      if (this.fullDomRenderFollowPending) return;
      const generation = this.tailFollowGeneration;
      this.fullDomRenderFollowPending = true;
      this.afterNextRender(() => {
        this.fullDomRenderFollowPending = false;
        if (
          generation !== this.tailFollowGeneration ||
          !this.tailFollow() ||
          !this.followingTail()
        ) {
          return;
        }
        this.scrollToBottomOffset(reason);
        this.recomputeBottomState();
      });
      return;
    }
    if (this.fullDomFollowFrame !== undefined) return;
    const generation = this.tailFollowGeneration;
    this.fullDomFollowFrame = requestAnimationFrame(() => {
      this.fullDomFollowFrame = undefined;
      if (
        generation !== this.tailFollowGeneration ||
        !this.tailFollow() ||
        !this.followingTail()
      ) {
        return;
      }
      this.scrollToBottomOffset(reason);
      this.recomputeBottomState();
    });
  }

  private noteTailGeometryChange(): void {
    this.tailGeometryChangedAt = Date.now();
  }

  /**
   * Experimental autosize retains a lifetime-weighted item-height average even
   * when a wholly different data set replaces the transcript. Reset only on a
   * proven session replacement so expanded content from the prior session
   * cannot determine the next session's rendered range. Calling `attach`
   * directly is deliberate: the strategy's attach path resets its averager and
   * recalculates the range, while a preceding detach creates a real empty-row
   * interval before CDK materializes the replacement range.
   */
  private resetAutoSizeEstimator(): void {
    const strategy = this.autoSize()._scrollStrategy;
    strategy.attach(this.viewport());
    this.noteTailGeometryChange();
    this.scrollToBottomOffset('estimator-reset');
  }

  private finishTranscriptTransitionWhenRendered(attempt = 0): void {
    if (this.transcriptTransitionFrame !== undefined) {
      cancelAnimationFrame(this.transcriptTransitionFrame);
    }
    this.transcriptTransitionFrame = requestAnimationFrame(() => {
      this.transcriptTransitionFrame = undefined;
      const hasRenderedRow =
        this.viewport().elementRef.nativeElement.querySelector(
          '.rv-transcript__item',
        ) !== null;
      if (hasRenderedRow || attempt >= 10) {
        this.transcriptTransitioning.set(false);
        return;
      }
      this.finishTranscriptTransitionWhenRendered(attempt + 1);
    });
  }

  private onRenderedContentResize(height: number): void {
    if (
      this.renderedContentHeight !== undefined &&
      Math.abs(this.renderedContentHeight - height) <= 0.5
    ) {
      return;
    }
    this.renderedContentHeight = height;
    this.noteTailGeometryChange();
    if (this.viewportReady && this.tailFollow() && this.followingTail()) {
      this.followMaterializedTailGeometryNow('tail-geometry-rendered-resize');
      this.scheduleMaterializedTailGeometryFollow();
      this.requestTailFollow();
    }
  }

  private onEstimatedTotalResize(height: number): void {
    if (
      this.estimatedTotalHeight !== undefined &&
      Math.abs(this.estimatedTotalHeight - height) <= 0.5
    ) {
      return;
    }
    this.estimatedTotalHeight = height;
    this.noteTailGeometryChange();
    if (this.viewportReady && this.tailFollow() && this.followingTail()) {
      this.followMaterializedTailGeometryNow('tail-geometry-estimated-resize');
      this.scheduleMaterializedTailGeometryFollow();
      this.requestTailFollow();
    }
  }

  /**
   * ResizeObserver runs before paint. Keep the materialized tail aligned in
   * that same frame instead of exposing CDK's intermediate spacer/wrapper
   * disagreement until the next Angular render and settlement timer.
   */
  private followMaterializedTailGeometryNow(
    reason: TranscriptScrollWriteReason,
  ): void {
    this.scrollToBottomOffset(reason);
    if (this.isTailMaterialized()) {
      this.reconcileMaterializedTailGeometry(false);
    }
    this.recomputeBottomState();
  }

  /**
   * CDK's own ResizeObserver can run after ours and update the wrapper transform
   * without changing its measured height, which provides no second observer
   * notification. Re-assert the coherent tail after all resize callbacks for
   * the frame have completed. A newly appended virtual row may materialize a
   * few frames after its data signal, so follow that bounded render window
   * until the streaming tail exists.
   */
  private scheduleMaterializedTailGeometryFollow(attempt = 0): void {
    if (this.tailGeometryFrame !== undefined) return;
    this.tailGeometryFrame = requestAnimationFrame(() => {
      this.tailGeometryFrame = undefined;
      if (!this.viewportReady || !this.tailFollow() || !this.followingTail()) {
        return;
      }
      if (
        this.tailIsStreaming() &&
        !this.isTailMaterialized() &&
        attempt < 10
      ) {
        this.scheduleMaterializedTailGeometryFollow(attempt + 1);
        return;
      }
      this.followMaterializedTailGeometryNow('tail-geometry-frame');
    });
  }

  private pauseTailFollow(): void {
    this.cancelPausedScrollHold();
    if (!this.followingTail()) return;
    this.followingTail.set(false);
    this.cancelTailFollowWork();
    this.cancelPendingSeeks();
  }

  private resumeTailFollow(): void {
    this.cancelTailFollowWork();
    this.cancelPausedScrollHold();
    this.resumeFollowOnUserScrollToTail = false;
    this.scrollbarDragActive = false;
    this.touchScrollActive = false;
    this.followingTail.set(true);
  }

  /** CDK autosize can preserve the provisional bottom instead of the user's
   * top offset while appending a variable-height row. Hold the pre-render
   * offset across its bounded measurement passes, but let the next gesture
   * cancel the hold immediately. */
  private holdPausedScrollOffset(offset: number): void {
    this.cancelPausedScrollHold();
    const generation = this.pausedScrollHoldGeneration;
    const startedAt = Date.now();

    const restore = (): void => {
      this.afterNextRender(() => {
        if (
          generation !== this.pausedScrollHoldGeneration ||
          this.followingTail()
        ) {
          return;
        }
        const viewport = this.viewport();
        if (Math.abs(viewport.measureScrollOffset('top') - offset) > 0.5) {
          this.writeScrollPosition('paused-offset-hold', offset, null, () => {
            viewport.scrollToOffset(offset);
          });
        }
        if (
          Date.now() - startedAt >=
          TranscriptViewportComponent.TAIL_SETTLE_MAX_MS
        ) {
          this.recomputeBottomState();
          return;
        }
        const timer = setTimeout(() => {
          this.pausedScrollHoldTimers.delete(timer);
          restore();
        }, 50);
        this.pausedScrollHoldTimers.add(timer);
      });
    };

    restore();
  }

  private cancelPausedScrollHold(): void {
    this.pausedScrollHoldGeneration += 1;
    for (const timer of this.pausedScrollHoldTimers) clearTimeout(timer);
    this.pausedScrollHoldTimers.clear();
  }

  private cancelTailFollowWork(): void {
    this.tailFollowGeneration += 1;
    this.tailFollowRenderPending = false;
    this.fullDomRenderFollowPending = false;
    if (this.fullDomFollowFrame !== undefined) {
      cancelAnimationFrame(this.fullDomFollowFrame);
      this.fullDomFollowFrame = undefined;
    }
    if (this.tailSettleTimer !== undefined) {
      clearTimeout(this.tailSettleTimer);
      this.tailSettleTimer = undefined;
    }
  }

  private scrollToBottomOffset(reason: TranscriptScrollWriteReason): void {
    if (this.fullDomPrototypeEnabled) {
      const host = this.scrollHost();
      this.writeScrollPosition(reason, host.scrollHeight, null, () => {
        host.scrollTop = host.scrollHeight;
      });
      return;
    }
    const vp = this.viewport();
    // Scroll to a very large offset — CDK clamps to the maximum scrollable
    // distance. This works with both fixed-size and autosize strategies.
    this.writeScrollPosition(reason, Number.MAX_SAFE_INTEGER, null, () => {
      vp.scrollToOffset(Number.MAX_SAFE_INTEGER);
    });
  }

  scrollToMessageId(messageId: string): void {
    this.pauseTailFollow();
    this.cancelPendingSeeks();
    const index = this.virtualRowIndexForMessage(messageId);
    if (index >= 0) {
      if (this.ownedWindowPrototypeEnabled) {
        this.placeOwnedWindowAround(index);
      }
      this.afterNextRender(() => {
        if (this.fullDomPrototypeEnabled) {
          const target = this.findRenderedMessageElement(messageId);
          if (target !== null) {
            this.writeScrollPosition(
              'seek-rendered-message',
              null,
              messageId,
              () => target.scrollIntoView({ block: 'nearest' }),
            );
          }
          return;
        }
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
      this.setRenderedMessages(this.messages());
    }

    const rendered = this.findRenderedMessageElement(messageId);
    if (rendered !== null) {
      this.writeScrollPosition('seek-rendered-message', null, messageId, () =>
        rendered.scrollIntoView({ block: 'nearest' }),
      );
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

    const rows = this.renderRows();
    if (rows.length === 0) return;

    const clampedIndex = Math.max(0, Math.min(index, rows.length - 1));
    if (clampedIndex === 0) {
      this.writeScrollPosition('seek-first-row', 0, null, () => {
        vp.scrollToOffset(0);
      });
      return;
    }

    if (clampedIndex >= rows.length - 1) {
      this.scrollToBottomFor('seek-tail');
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

    const requestedOffset = Math.max(0, nextOffset);
    this.writeScrollPosition(
      'seek-estimated-row',
      requestedOffset,
      null,
      () => {
        vp.scrollToOffset(requestedOffset);
      },
    );
  }

  private virtualRowIndexForMessage(messageId: string): number {
    return this.renderRows().findIndex((row) =>
      row.messages.some((message) => message.id === messageId),
    );
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
    const host = this.scrollHost();
    const items = host.querySelectorAll<HTMLElement>(
      '[data-testid="transcript-item"]',
    );
    for (let i = 0; i < items.length; i++) {
      const item = items.item(i);
      if (item.dataset['messageId'] === messageId) return item;
    }
    return null;
  }

  private settleScrollToBottom(
    attempt: number,
    generation: number,
    startedAt = Date.now(),
  ): void {
    if (
      Date.now() - startedAt >=
      TranscriptViewportComponent.TAIL_SETTLE_MAX_MS
    ) {
      this.recomputeBottomState();
      return;
    }
    if (this.tailSettleTimer !== undefined) {
      clearTimeout(this.tailSettleTimer);
    }
    this.tailSettleTimer = setTimeout(() => {
      this.tailSettleTimer = undefined;
      this.afterNextRender(() => {
        if (
          generation !== this.tailFollowGeneration ||
          !this.tailFollow() ||
          !this.followingTail()
        ) {
          return;
        }
        const bottomOffset = this.viewport().measureScrollOffset('bottom');
        const tailMaterialized = this.isTailMaterialized();
        // Keep the materialized wrapper and spacer coherent even while a
        // stable virtual row is streaming. Streaming trusts the freshly
        // measured wrapper; terminal settlement trusts CDK's stable spacer.
        if (tailMaterialized && this.reconcileMaterializedTailGeometry(false)) {
          this.settleScrollToBottom(attempt + 1, generation, startedAt);
          return;
        }
        if (!this.tailGeometryCanReconcile()) {
          // Keep following real growth, but leave CDK's size estimate alone
          // until the active row stops changing. A later settlement attempt
          // performs the stale-spacer repair against stable measurements.
          if (bottomOffset > TranscriptViewportComponent.BOTTOM_THRESHOLD_PX) {
            this.scrollToBottomOffset('tail-follow-settle');
          }
          this.settleScrollToBottom(attempt + 1, generation, startedAt);
          return;
        }
        if (tailMaterialized && this.reconcileMaterializedTailGeometry(true)) {
          this.settleScrollToBottom(attempt + 1, generation, startedAt);
          return;
        }
        // Autosize may temporarily report a zero bottom offset while its
        // estimator still has not materialized the actual last row. Stopping
        // at that provisional bottom is what could hide a final_answer after
        // a long refreshed transcript. Only settle once the tail row exists.
        if (
          bottomOffset <= TranscriptViewportComponent.BOTTOM_THRESHOLD_PX &&
          tailMaterialized
        ) {
          this.isAtBottom.set(true);
          return;
        }
        // Autosize can converge on a provisional content size whose reported
        // bottom is real in pixels but whose rendered range stops one or more
        // rows before the data tail. Repeating the same clamped offset cannot
        // escape that estimate. After a few normal attempts, explicitly seed a
        // tail range; the strategy remeasures it on the next render and can
        // then place the actual final row at the bottom.
        if (attempt >= 3 && !this.isTailMaterialized()) {
          this.materializeTailRange();
        } else {
          this.scrollToBottomOffset('tail-follow-settle');
        }
        this.settleScrollToBottom(attempt + 1, generation, startedAt);
      });
    }, 50);
  }

  private tailGeometryCanReconcile(): boolean {
    return (
      !this.tailIsStreaming() &&
      tailGeometryIsStable(
        this.tailGeometryChangedAt,
        Date.now(),
        TranscriptViewportComponent.TAIL_GEOMETRY_QUIET_MS,
      )
    );
  }

  private tailIsStreaming(): boolean {
    return this.renderMessages().some(
      (message) => message.status === 'streaming',
    );
  }

  private isTailMaterialized(): boolean {
    const lastMessage = this.renderMessages().at(-1);
    return (
      lastMessage === undefined ||
      this.findRenderedMessageElement(lastMessage.id) !== null
    );
  }

  /** Keep a materialized tail aligned with the browser's authoritative scroll extent. */
  private reconcileMaterializedTailGeometry(
    includeViewportCoverageRepair: boolean,
  ): boolean {
    const viewport = this.viewport();
    const measurement = this.measureTranscriptGeometry();
    if (measurement === undefined) return false;
    if (
      measurement.totalContentSize <= 0 ||
      measurement.renderedContentSize <= 0
    ) {
      return false;
    }
    const assessment = assessTranscriptGeometry(measurement);
    if (!assessment.tailRangeMaterialized) return false;

    if (!assessment.tailEndCoherent) {
      if (this.tailIsStreaming()) {
        // The rendered streaming tail is the fresh measurement; the spacer is
        // an autosize estimate which can lag a growing row in either direction.
        // Preserve the visible wrapper and make the scroll extent meet its real
        // end, then pin the viewport to that corrected bottom.
        viewport.setTotalContentSize(assessment.renderedContentEnd);
        this.writeScrollPosition(
          'geometry-reconcile-streaming',
          Number.MAX_SAFE_INTEGER,
          null,
          () => viewport.scrollToOffset(Number.MAX_SAFE_INTEGER),
        );
        return true;
      }
      // For settled content, correct only the independently positioned wrapper.
      // The browser scroll extent already resolves whether the spacer or the
      // rendered content reaches farther.
      viewport.setRenderedContentOffset(
        assessment.correctedRenderedContentOffset,
      );
      this.writeScrollPosition(
        'geometry-reconcile-settled',
        Number.MAX_SAFE_INTEGER,
        null,
        () => viewport.scrollToOffset(Number.MAX_SAFE_INTEGER),
      );
      return true;
    }

    if (!includeViewportCoverageRepair) return false;

    if (assessment.tailViewportCovered) return false;

    // A retained average dominated by tall expanded content can predict that
    // one short row fills the viewport. Reset the estimator and let its normal
    // render path choose a default-size tail window. Directly forcing a range
    // here would bypass autosize's cached offset/size bookkeeping.
    this.resetAutoSizeEstimator();
    return true;
  }

  private measureTranscriptGeometry():
    | TranscriptGeometryMeasurement
    | undefined {
    const viewport = this.viewport();
    const host = viewport.elementRef.nativeElement;
    const contentWrapper = host.querySelector<HTMLElement>(
      '.cdk-virtual-scroll-content-wrapper',
    );
    const spacer = host.querySelector<HTMLElement>(
      '.cdk-virtual-scroll-spacer',
    );
    if (contentWrapper === null || spacer === null) return undefined;

    const hostBounds = host.getBoundingClientRect();
    const contentBounds = contentWrapper.getBoundingClientRect();
    const renderedItems = contentWrapper.querySelectorAll<HTMLElement>(
      '.rv-transcript__item',
    );
    const lastRenderedItem = renderedItems.item(renderedItems.length - 1);
    const measuredRenderedContentSize =
      lastRenderedItem === null
        ? contentBounds.height
        : Math.max(
            0,
            lastRenderedItem.getBoundingClientRect().bottom - contentBounds.top,
          );
    return {
      dataLength: this.renderRows().length,
      renderedRange: viewport.getRenderedRange(),
      viewportSize: host.clientHeight,
      scrollOffset: viewport.measureScrollOffset('top'),
      scrollSize: host.scrollHeight,
      // A grouped streaming row can temporarily extend beyond CDK's spacer.
      // Browser scrollHeight already resolves both competing extents and is
      // therefore the authoritative total the user can actually scroll.
      totalContentSize: host.scrollHeight,
      renderedContentOffset:
        viewport.measureScrollOffset('top') +
        contentBounds.top -
        hostBounds.top,
      // The CDK wrapper and virtual row can retain trailing strategy space.
      // The final semantic message is the authoritative visible content end
      // for tail geometry and blank-space detection.
      renderedContentSize: measuredRenderedContentSize,
    };
  }

  private materializeTailRange(): void {
    const length = this.renderRows().length;
    if (length === 0) return;
    // Reattaching resets the retained average and uses autosize's own range,
    // offset, and total-size update path to materialize the tail coherently.
    this.resetAutoSizeEstimator();
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
    this.writeScrollPosition(
      'prepend-anchor-restore',
      scrollOffsetFromTop,
      null,
      () => vp.scrollToOffset(scrollOffsetFromTop),
    );
  }
}

/**
 * Build the stable data rows owned by the virtualizer.
 *
 * Every projected message owns one stable row. External app-server projection
 * now places a native turn's reasoning, tools, commands, and answer in one
 * ChatMessage, so CDK no longer needs a second stateful grouping layer.
 */
export function projectTranscriptVirtualRows(
  messages: readonly ChatMessage[],
  previousRows: readonly TranscriptVirtualRow[] = [],
): readonly TranscriptVirtualRow[] {
  const previousById = new Map(previousRows.map((row) => [row.id, row]));
  const rows = messages.map((message) => {
    const id = `message:${message.id}`;
    const previous = previousById.get(id);
    const previousMessage = previous?.messages[0];
    if (
      previous !== undefined &&
      previous.messages.length === 1 &&
      !messageRenderChanged(previousMessage, message)
    ) {
      return previous;
    }
    return { id, messages: [message] } satisfies TranscriptVirtualRow;
  });
  return rows.length === previousRows.length &&
    rows.every((row, index) => row === previousRows[index])
    ? previousRows
    : rows;
}

/** Stable primitive used by the search effect so fresh result objects do not
 * restart the same seek chain. */
export function transcriptSearchSeekKey(
  query: string,
  result: { readonly id: string } | undefined,
): string | undefined {
  return query.trim().length === 0 ? undefined : result?.id;
}

/** Whether CDK has had enough quiet time to reconcile its autosize estimate. */
export function tailGeometryIsStable(
  lastChangeAt: number,
  now: number,
  quietPeriodMs: number,
): boolean {
  return now - lastChangeAt >= quietPeriodMs;
}

/**
 * Detect changes that can alter the transcript tail's height or identity.
 * Polling/projection layers may emit fresh arrays containing identical data;
 * those idle refreshes must not restart auto-scroll settlement.
 */
export function transcriptTailChanged(
  previous: readonly ChatMessage[],
  current: readonly ChatMessage[],
): boolean {
  if (previous.length !== current.length) return true;
  if (messagePresentationChanged(previous.at(-1), current.at(-1))) return true;

  // An optimistic user row can briefly remain after an authoritative
  // streaming row while the native user item catches up. Detect growth in any
  // active row so that a stable optimistic tail cannot mask the geometry
  // change and bypass managed tail-follow.
  for (let index = current.length - 2; index >= 0; index -= 1) {
    const before = previous[index];
    const after = current[index];
    if (before?.status !== 'streaming' && after?.status !== 'streaming') {
      continue;
    }
    if (messagePresentationChanged(before, after)) return true;
  }
  return false;
}

/** Detect any visible projection change without treating fresh identical
 * objects from idle polling as transcript activity. */
export function transcriptPresentationChanged(
  previous: readonly ChatMessage[],
  current: readonly ChatMessage[],
): boolean {
  if (previous.length !== current.length) return true;
  return current.some((message, index) =>
    messageRenderChanged(previous[index], message),
  );
}

function messageRenderChanged(
  before: ChatMessage | undefined,
  after: ChatMessage | undefined,
): boolean {
  if (before === after) return false;
  if (before === undefined || after === undefined) return before !== after;
  if (
    before.id !== after.id ||
    before.sessionId !== after.sessionId ||
    before.createdAt !== after.createdAt ||
    before.status !== after.status ||
    before.author.role !== after.author.role ||
    before.author.displayName !== after.author.displayName ||
    jsonValueChanged(before.author.speaker, after.author.speaker) ||
    jsonValueChanged(before.tree, after.tree) ||
    jsonValueChanged(before.metadata, after.metadata) ||
    before.blocks.length !== after.blocks.length
  ) {
    return true;
  }
  return before.blocks.some((block, index) => {
    const next = after.blocks[index];
    return (
      next === undefined ||
      block.id !== next.id ||
      block.messageId !== next.messageId ||
      block.kind !== next.kind ||
      block.content !== next.content ||
      block.estimatedHeight !== next.estimatedHeight ||
      block.renderPolicy !== next.renderPolicy ||
      jsonValueChanged(block.tool, next.tool) ||
      jsonValueChanged(block.textSpans, next.textSpans) ||
      jsonValueChanged(block.attachment, next.attachment) ||
      jsonValueChanged(block.metadata, next.metadata)
    );
  });
}

function jsonValueChanged(before: unknown, after: unknown): boolean {
  if (before === after) return false;
  return JSON.stringify(before) !== JSON.stringify(after);
}

function messagePresentationChanged(
  before: ChatMessage | undefined,
  after: ChatMessage | undefined,
): boolean {
  if (before === after) return false;
  if (before === undefined || after === undefined) return before !== after;
  if (before.id !== after.id || before.status !== after.status) return true;
  if (before.blocks.length !== after.blocks.length) return true;
  return before.blocks.some((block, index) => {
    const next = after.blocks[index];
    return (
      next === undefined ||
      block.id !== next.id ||
      block.kind !== next.kind ||
      block.content !== next.content ||
      block.renderPolicy !== next.renderPolicy
    );
  });
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
