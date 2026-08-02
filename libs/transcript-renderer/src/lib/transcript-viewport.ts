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
  projectTranscriptWindowGeometry,
  TRANSCRIPT_WINDOW_ROW_COUNT,
} from './transcript-window-geometry';

const EMPTY_BLOCK_SET = new Set<string>();

export interface TranscriptVirtualRow {
  readonly id: string;
  readonly messages: readonly ChatMessage[];
}

export type TranscriptScrollWriteReason =
  | 'explicit-latest'
  | 'paused-anchor-compensation'
  | 'tail-follow-render'
  | 'seek-rendered-message'
  | 'session-replacement';

type TranscriptViewportState =
  | 'following'
  | 'paused'
  | 'seeking'
  | 'session-replacement';

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
 * Bounded, chronological transcript viewport.
 *
 * The component owns one keyed 64-row window with conservative spacers. One
 * explicit application authority owns paused anchoring on every browser; every
 * programmatic scroll goes through `writeScrollPosition` and is attributed to
 * application or user input.
 *
 * Scroll behavior:
 * - Tail-follow: when the user is at the bottom, new content auto-scrolls.
 *   When the user scrolls up, tail-follow pauses (no fighting the user).
 * - Jump-to-message: admit the target's keyed window, then scroll the semantic
 *   message into view.
 * - Scroll anchor preservation: a coalesced ResizeObserver correction keeps
 *   the paused semantic row stable while prepend and variable-height content
 *   change around it. CSS anchoring is disabled so the two authorities cannot
 *   race each other on Chromium/Firefox or disappear entirely on WebKit.
 *
 * Streaming-safe: each message is a separate OnPush component. When a text
 * delta updates one message, only that message's view re-renders; non-resident
 * and presentation-identical rows retain their stable projection identity.
 *
 * The bounded window is hidden behind this component's input/output API so its
 * geometry policy can evolve without affecting callers.
 */
@Component({
  selector: 'rv-transcript-viewport',
  imports: [MessageItemComponent],
  templateUrl: './transcript-viewport.html',
  styleUrl: './transcript-viewport.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranscriptViewportComponent {
  private readonly viewportElement =
    viewChild.required<ElementRef<HTMLElement>>('viewportElement');

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
  private static readonly OWNED_WINDOW_ADMISSION_FRAME_BUDGET = 8;

  private readonly viewportState = signal<TranscriptViewportState>('following');
  protected readonly isAtBottom = signal(true);
  protected readonly followingTail = computed(
    () => this.viewportState() === 'following',
  );
  protected readonly transcriptTransitioning = computed(
    () => this.viewportState() === 'session-replacement',
  );
  protected readonly showScrollToBottom = computed(
    () =>
      this.renderMessages().length > 0 &&
      (!this.isAtBottom() || !this.followingTail()),
  );

  /** Previous messages reference — used to detect prepends for anchor preservation. */
  private previousMessages: readonly ChatMessage[] = [];

  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private tailFollowGeneration = 0;
  private tailFollowRenderPending = false;
  private previousTranscriptKey: string | undefined;
  private resumeFollowOnUserScrollToTail = false;
  private scrollbarDragActive = false;
  private touchScrollActive = false;
  private tailFollowFrame: number | undefined;
  private seekFrame: number | undefined;
  private pendingSeekSource: 'programmatic' | 'search' | undefined;
  private seekGeneration = 0;
  private ownedWindowEndFrame: number | undefined;
  private ownedWindowEndGeneration = 0;
  private ownedWindowEndAdmissionPending = false;
  private scrollDiagnosticsEnabled = false;
  private scrollWriteSequence = 0;
  private scrollWriteFrame = 0;
  private scrollWriteFrameOpen = false;
  private readonly scrollWriteTrace: TranscriptScrollWriteTrace[] = [];
  private pausedAnchor:
    | { readonly messageId: string; readonly viewportTop: number }
    | undefined;
  private pausedAnchorObserver: ResizeObserver | undefined;
  private pausedAnchorMutationObserver: MutationObserver | undefined;
  private pausedAnchorFrame: number | undefined;
  private pausedAnchorRenderPending = false;
  private pausedAnchorWritePending = false;

  private static readonly MAX_SCROLL_TRACE_ENTRIES = 500;

  /** Presentation-stable rows and the sole bounded resident window. */
  protected readonly renderMessages = signal<readonly ChatMessage[]>([]);
  protected readonly renderRows = signal<readonly TranscriptVirtualRow[]>([]);
  private readonly ownedWindowStart = signal(0);
  private readonly windowGeometry = computed(() =>
    projectTranscriptWindowGeometry(
      this.renderRows().length,
      this.ownedWindowStart(),
    ),
  );
  protected readonly windowRenderRows = computed(() => {
    const rows = this.renderRows();
    const geometry = this.windowGeometry();
    return rows.slice(geometry.start, geometry.end);
  });
  protected readonly ownedWindowTopSpacerPx = computed(
    () => this.windowGeometry().topSpacerPx,
  );
  protected readonly ownedWindowBottomSpacerPx = computed(
    () => this.windowGeometry().bottomSpacerPx,
  );
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

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.tailFollowFrame !== undefined) {
        cancelAnimationFrame(this.tailFollowFrame);
      }
      if (this.seekFrame !== undefined) cancelAnimationFrame(this.seekFrame);
      if (this.ownedWindowEndFrame !== undefined) {
        cancelAnimationFrame(this.ownedWindowEndFrame);
      }
      if (this.pausedAnchorFrame !== undefined) {
        cancelAnimationFrame(this.pausedAnchorFrame);
      }
      this.pausedAnchorObserver?.disconnect();
      this.pausedAnchorMutationObserver?.disconnect();
    });

    this.afterNextRender(() => this.installPausedAnchorObserver());

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

      this.cancelPendingSeeks();
      this.cancelTailFollowWork();
      this.viewportState.set('session-replacement');
      this.previousMessages = [];
      this.isAtBottom.set(true);
      const replacementMessages = this.messages();
      if (replacementMessages.length > 0) {
        this.admitSessionReplacement(replacementMessages);
      }
    });

    // Fresh object graphs from polling are common. Keep byte-identical visible
    // projections entirely outside the renderer and scroll state machine.
    effect(() => {
      const msgs = this.messages();
      if (this.transcriptTransitioning()) {
        // A composition layer may publish the new conversation identity one
        // render before its projection. Keep the previous keyed window
        // resident behind the transition state instead of exposing an empty
        // semantic frame, then replace it atomically once content is ready.
        if (msgs.length === 0) return;
        if (transcriptPresentationChanged(this.renderMessages(), msgs)) {
          this.admitSessionReplacement(msgs);
        }
        return;
      }
      if (!transcriptPresentationChanged(this.renderMessages(), msgs)) return;
      this.setRenderedMessages(msgs, true);
    });

    // Presentation controls can change row height without changing messages.
    // Angular performs the layout; following mode contributes one coalesced
    // post-render tail write, while native anchoring exclusively owns paused
    // layout changes.
    effect(() => {
      const visibility = this.activityVisibility();
      void visibility.reasoning;
      void visibility.tools;
      void this.autoExpandReasoning();
      void this.showRevisionActions();
      void this.alternateSlots().length;
      if (this.tailFollow() && this.followingTail()) {
        this.requestTailPlacement('tail-follow-render', true);
      } else if (this.viewportState() === 'paused') {
        this.requestPausedAnchorCompensationAfterRender();
      }
    });

    // The cross-browser paused anchor observer exclusively owns paused growth
    // and prepend. CSS overflow anchoring remains disabled to avoid a second
    // authority racing these coalesced corrections.
    effect(() => {
      const msgs = this.renderMessages();
      const prev = this.previousMessages;
      this.previousMessages = msgs;

      if (msgs.length === 0) return;

      const tailChanged = transcriptTailChanged(prev, msgs);

      // Keep a compatibility fallback for standalone consumers that have not
      // supplied a transcript key. The app shell always supplies one.
      const replaced =
        this.transcriptKey() === undefined && messagesWereReplaced(prev, msgs);
      if (replaced) {
        this.cancelPendingSeeks();
        this.cancelTailFollowWork();
        this.viewportState.set('session-replacement');
        this.isAtBottom.set(true);
        this.placeOwnedWindowAtTail();
        this.finishSessionReplacementAfterRender();
        return;
      }

      if (tailChanged && this.tailFollow() && this.followingTail()) {
        this.requestTailPlacement('tail-follow-render', true);
      }
    });

    // Jump-to-message: when targetMessageId changes, scroll to that message.
    effect(() => {
      const targetId = this.targetMessageId();
      if (targetId === undefined) return;
      untracked(() => this.scrollToMessageId(targetId));
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
        if (this.pendingSeekSource === 'search') this.cancelPendingSeeks();
        return;
      }
      const result = untracked(() => this.activeSearchResult());
      if (result?.id !== seekKey) return;
      untracked(() => this.scrollToMessageId(result.messageId, 'search'));
    });
  }

  private scrollHost(): HTMLElement {
    return this.viewportElement().nativeElement;
  }

  /** Install presentation-stable message rows into the keyed window. */
  private setRenderedMessages(
    messages: readonly ChatMessage[],
    presentationChanged?: boolean,
  ): readonly TranscriptVirtualRow[] {
    const previousMessages = this.renderMessages();
    const previousRows = this.renderRows();
    const previousWindowFirstId = previousRows[this.ownedWindowStart()]?.id;
    const changed =
      presentationChanged ??
      transcriptPresentationChanged(previousMessages, messages);
    if (!changed) {
      return this.renderRows();
    }
    const rows = projectTranscriptVirtualRows(messages, previousRows);
    this.renderMessages.set(messages);
    this.renderRows.set(rows);
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
          Math.max(0, rows.length - TRANSCRIPT_WINDOW_ROW_COUNT),
        ),
      );
    }
    if (this.viewportState() === 'paused') {
      this.requestPausedAnchorCompensationAfterRender();
    }
    return rows;
  }

  private placeOwnedWindowAtTail(): void {
    const start = Math.max(
      0,
      this.renderRows().length - TRANSCRIPT_WINDOW_ROW_COUNT,
    );
    this.ownedWindowStart.set(start);
  }

  private admitSessionReplacement(messages: readonly ChatMessage[]): void {
    this.setRenderedMessages(messages);
    this.placeOwnedWindowAtTail();
    this.finishSessionReplacementAfterRender();
  }

  private placeOwnedWindowAround(index: number): void {
    const rows = this.renderRows();
    const half = Math.floor(TRANSCRIPT_WINDOW_ROW_COUNT / 2);
    const maxStart = Math.max(0, rows.length - TRANSCRIPT_WINDOW_ROW_COUNT);
    this.ownedWindowStart.set(Math.max(0, Math.min(maxStart, index - half)));
  }

  private syncOwnedWindowToScrollPosition(): void {
    if (
      this.ownedWindowEndAdmissionPending ||
      this.viewportState() === 'seeking' ||
      this.viewportState() === 'session-replacement' ||
      this.renderRows().length === 0
    ) {
      return;
    }
    const host = this.scrollHost();
    const maximum = Math.max(1, host.scrollHeight - host.clientHeight);
    const fraction = Math.max(0, Math.min(1, host.scrollTop / maximum));
    const index = Math.round(fraction * (this.renderRows().length - 1));
    const currentStart = this.ownedWindowStart();
    const currentEnd = currentStart + TRANSCRIPT_WINDOW_ROW_COUNT;
    if (index < currentStart + 16 || index >= currentEnd - 16) {
      this.placeOwnedWindowAround(index);
    }
  }

  /** Called on viewport scroll to track whether the user is at the bottom. */
  protected onScroll(): void {
    this.syncOwnedWindowToScrollPosition();
    this.recomputeBottomState();
    if (this.viewportState() === 'paused' && !this.pausedAnchorWritePending) {
      this.requestPausedAnchorCapture();
    }
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
    if (event.deltaY < 0) {
      this.resumeFollowOnUserScrollToTail = false;
      this.pauseTailFollow();
      this.releasePausedAnchorForUserInput();
    } else if (event.deltaY > 0 && !this.followingTail()) {
      this.resumeFollowOnUserScrollToTail = true;
      this.releasePausedAnchorForUserInput();
    }
  }

  /** Touch scrolling always begins under user control. */
  protected onTouchStart(): void {
    this.cancelOwnedWindowEndAdmission();
    this.touchScrollActive = true;
    this.resumeFollowOnUserScrollToTail = false;
    this.pauseTailFollow();
    this.releasePausedAnchorForUserInput();
  }

  protected onTouchEnd(): void {
    this.touchScrollActive = false;
    this.resumeFollowIfUserReachedTail();
  }

  /** Cancel pending owned tail admission before a scrollbar drag begins. */
  protected onPointerDown(event: PointerEvent): void {
    const host = this.scrollHost();
    const bounds = host.getBoundingClientRect();
    const scrollbarWidth = Math.max(16, host.offsetWidth - host.clientWidth);
    if (event.clientX >= bounds.right - scrollbarWidth) {
      this.cancelOwnedWindowEndAdmission();
      this.scrollbarDragActive = true;
      this.resumeFollowOnUserScrollToTail = false;
      this.pauseTailFollow();
      this.releasePausedAnchorForUserInput();
    }
  }

  protected onKeyboardScroll(event: KeyboardEvent): void {
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
    this.releasePausedAnchorForUserInput();
    if (event.key === 'End') {
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
    this.requestTailPlacement(reason);
  }

  /** Each render turn can request at most one application-owned tail write. */
  private requestTailPlacement(
    reason: TranscriptScrollWriteReason,
    afterRender = false,
  ): void {
    this.placeOwnedWindowAtTail();
    if (afterRender) {
      if (this.tailFollowRenderPending) return;
      const generation = this.tailFollowGeneration;
      this.tailFollowRenderPending = true;
      this.afterNextRender(() => {
        this.tailFollowRenderPending = false;
        if (
          generation !== this.tailFollowGeneration ||
          !this.tailFollow() ||
          !this.followingTail() ||
          this.scrollHost().clientHeight <= 0
        ) {
          return;
        }
        this.scrollToBottomOffset(reason);
        this.recomputeBottomState();
      });
      return;
    }
    if (this.tailFollowFrame !== undefined) return;
    const generation = this.tailFollowGeneration;
    this.tailFollowFrame = requestAnimationFrame(() => {
      this.tailFollowFrame = undefined;
      if (
        generation !== this.tailFollowGeneration ||
        !this.tailFollow() ||
        !this.followingTail() ||
        this.scrollHost().clientHeight <= 0
      ) {
        return;
      }
      this.scrollToBottomOffset(reason);
      this.recomputeBottomState();
    });
  }

  private finishSessionReplacementAfterRender(): void {
    this.afterNextRender(() => {
      if (!this.transcriptTransitioning()) return;
      const host = this.scrollHost();
      if (host.clientHeight <= 0) {
        this.viewportState.set('following');
        return;
      }
      this.writeScrollPosition(
        'session-replacement',
        host.scrollHeight,
        null,
        () => {
          host.scrollTop = host.scrollHeight;
        },
      );
      this.viewportState.set('following');
      this.recomputeBottomState();
    });
  }

  private pauseTailFollow(): void {
    if (this.viewportState() === 'paused') {
      this.requestPausedAnchorCapture();
      return;
    }
    this.cancelTailFollowWork();
    // A semantic seek has already admitted its target window. Let that single
    // requested placement finish even if a wheel event arrives in the render
    // gap; explicit replacement or another seek still cancels it through
    // `cancelPendingSeeks`.
    if (this.viewportState() !== 'seeking') this.seekGeneration += 1;
    this.viewportState.set('paused');
    this.capturePausedAnchor();
  }

  private resumeTailFollow(): void {
    this.cancelTailFollowWork();
    this.seekGeneration += 1;
    this.resumeFollowOnUserScrollToTail = false;
    this.scrollbarDragActive = false;
    this.touchScrollActive = false;
    this.pausedAnchor = undefined;
    this.viewportState.set('following');
  }

  private cancelTailFollowWork(): void {
    this.tailFollowGeneration += 1;
    this.tailFollowRenderPending = false;
    if (this.tailFollowFrame !== undefined) {
      cancelAnimationFrame(this.tailFollowFrame);
      this.tailFollowFrame = undefined;
    }
  }

  private scrollToBottomOffset(reason: TranscriptScrollWriteReason): void {
    const host = this.scrollHost();
    this.writeScrollPosition(reason, host.scrollHeight, null, () => {
      host.scrollTop = host.scrollHeight;
    });
  }

  scrollToMessageId(
    messageId: string,
    source: 'programmatic' | 'search' = 'programmatic',
  ): void {
    this.cancelPendingSeeks();
    const index = this.virtualRowIndexForMessage(messageId);
    if (index < 0) return;
    this.cancelTailFollowWork();
    this.viewportState.set('seeking');
    this.pendingSeekSource = source;
    const generation = this.seekGeneration;
    this.placeOwnedWindowAround(index);
    this.seekFrame = requestAnimationFrame(() => {
      this.seekFrame = undefined;
      if (generation !== this.seekGeneration) return;
      const target = this.findRenderedMessageElement(messageId);
      if (target !== null) {
        this.writeScrollPosition('seek-rendered-message', null, messageId, () =>
          // Put the semantic target at the viewport start. `nearest` can leave
          // a tall target partially above the viewport, which makes a later
          // image decode or reasoning expansion move the first visible row
          // even though the user explicitly sought this message.
          target.scrollIntoView({ block: 'start' }),
        );
      }
      this.viewportState.set('paused');
      this.capturePausedAnchor();
      this.pendingSeekSource = undefined;
      this.recomputeBottomState();
    });
  }

  private cancelPendingSeeks(): void {
    this.seekGeneration += 1;
    this.pendingSeekSource = undefined;
    if (this.seekFrame !== undefined) {
      cancelAnimationFrame(this.seekFrame);
      this.seekFrame = undefined;
    }
    if (this.viewportState() === 'seeking') {
      this.viewportState.set('paused');
    }
  }

  private afterNextRender(callback: () => void): void {
    afterNextRender(callback, { injector: this.injector });
  }

  private installPausedAnchorObserver(): void {
    const host = this.scrollHost();
    const content = host.querySelector<HTMLElement>(
      '.rv-transcript__owned-window-content',
    );
    if (content === null || typeof ResizeObserver === 'undefined') return;
    this.pausedAnchorObserver = new ResizeObserver(() => {
      if (
        this.viewportState() !== 'paused' ||
        this.pausedAnchor === undefined
      ) {
        return;
      }
      this.requestPausedAnchorCompensation();
    });
    this.pausedAnchorObserver.observe(content);
    this.pausedAnchorMutationObserver = new MutationObserver(() => {
      if (
        this.viewportState() !== 'paused' ||
        this.pausedAnchor === undefined
      ) {
        return;
      }
      // Mutation delivery precedes the next animation-frame callback. Force
      // the new layout here so the semantic anchor is corrected before any
      // frame can observe the intermediate geometry. ResizeObserver remains
      // the fallback for media/font layout changes without a DOM mutation.
      this.compensatePausedAnchor();
    });
    this.pausedAnchorMutationObserver.observe(content, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    this.pausedAnchorMutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  private requestPausedAnchorCapture(): void {
    if (this.pausedAnchorFrame !== undefined) {
      cancelAnimationFrame(this.pausedAnchorFrame);
    }
    this.pausedAnchorFrame = requestAnimationFrame(() => {
      this.pausedAnchorFrame = undefined;
      if (this.viewportState() === 'paused') this.capturePausedAnchor();
    });
  }

  private releasePausedAnchorForUserInput(): void {
    this.pausedAnchor = undefined;
    if (this.pausedAnchorFrame !== undefined) {
      cancelAnimationFrame(this.pausedAnchorFrame);
      this.pausedAnchorFrame = undefined;
    }
  }

  private capturePausedAnchor(): void {
    const host = this.scrollHost();
    const hostBounds = host.getBoundingClientRect();
    const rows = Array.from(
      host.querySelectorAll<HTMLElement>('[data-message-id]'),
    );
    const anchor =
      rows.find((row) => {
        const bounds = row.getBoundingClientRect();
        return (
          bounds.top >= hostBounds.top - 1 &&
          bounds.bottom <= hostBounds.bottom + 1
        );
      }) ??
      rows.find((row) => {
        const bounds = row.getBoundingClientRect();
        return (
          bounds.bottom > hostBounds.top + 1 &&
          bounds.top < hostBounds.bottom - 1
        );
      });
    const messageId = anchor?.dataset['messageId'];
    if (anchor === undefined || messageId === undefined) {
      this.pausedAnchor = undefined;
      return;
    }
    this.pausedAnchor = {
      messageId,
      viewportTop: anchor.getBoundingClientRect().top - hostBounds.top,
    };
  }

  private requestPausedAnchorCompensation(): void {
    if (this.pausedAnchorFrame !== undefined) return;
    this.pausedAnchorFrame = requestAnimationFrame(() => {
      this.pausedAnchorFrame = undefined;
      this.compensatePausedAnchor();
    });
  }

  private requestPausedAnchorCompensationAfterRender(): void {
    if (this.pausedAnchorRenderPending) return;
    this.pausedAnchorRenderPending = true;
    this.afterNextRender(() => {
      this.pausedAnchorRenderPending = false;
      this.compensatePausedAnchor();
    });
  }

  private compensatePausedAnchor(): void {
    const anchor = this.pausedAnchor;
    if (this.viewportState() !== 'paused' || anchor === undefined) return;
    const host = this.scrollHost();
    const row = Array.from(
      host.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).find((candidate) => candidate.dataset['messageId'] === anchor.messageId);
    if (row === undefined) {
      this.capturePausedAnchor();
      return;
    }
    const currentTop =
      row.getBoundingClientRect().top - host.getBoundingClientRect().top;
    const delta = currentTop - anchor.viewportTop;
    if (Math.abs(delta) <= 0.5) return;
    const target = host.scrollTop + delta;
    this.pausedAnchorWritePending = true;
    this.writeScrollPosition(
      'paused-anchor-compensation',
      target,
      anchor.messageId,
      () => {
        host.scrollTop = target;
      },
    );
    requestAnimationFrame(() => {
      this.pausedAnchorWritePending = false;
    });
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

  private virtualRowIndexForMessage(messageId: string): number {
    return this.renderRows().findIndex((row) =>
      row.messages.some((message) => message.id === messageId),
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
}

/**
 * Build stable keyed data rows for the resident window.
 *
 * Every projected message owns one stable row. External app-server projection
 * now places a native turn's reasoning, tools, commands, and answer in one
 * ChatMessage, so the viewport needs no second stateful grouping layer.
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
