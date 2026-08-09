import type {
  ChatEvent,
  ChatSessionSummary,
  LogicalTurnOperatorState,
  LogicalTurnPhase,
  LogicalTurnProgress,
  LogicalTurnProgressClassification,
  ToolCallDebugDetail as ProtocolToolCallDebugDetail,
  ToolCallDebugValue as ProtocolToolCallDebugValue,
} from '@rusty-view/protocol';

/**
 * @rusty-view/chat-domain domain types.
 *
 * These are FRONTEND domain/view-model types, not wire types. Wire types live in
 * @rusty-view/protocol. The {@link projectConversation} reducer converts
 * protocol ChatEvents into these view-model types.
 */

// ---- message author ----

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Product-agnostic visible speaker identity for transcript chrome.
 *
 * Downstream apps may derive this from users, characters, services, tools, or
 * any other speaker concept. Rusty View treats it only as display metadata.
 */
export interface MessageSpeakerIdentity {
  /** Visible speaker label. Falls back to MessageAuthor.displayName/role. */
  readonly label?: string;
  /** Optional avatar image URL. */
  readonly avatarUrl?: string;
  /** Optional fallback initials when no avatar image is present. */
  readonly initials?: string;
  /** Accessible label for the avatar image/badge. Falls back to label. */
  readonly avatarAlt?: string;
}

export interface MessageAuthor {
  readonly role: MessageRole;
  readonly displayName: string | undefined;
  readonly speaker?: MessageSpeakerIdentity;
}

// ---- message blocks ----

export type KnownMessageBlockKind =
  | 'text'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'debug'
  | 'command'
  | 'attachment'
  | 'service_notice';

export type MessageBlockKind = KnownMessageBlockKind | (string & {});

export type RenderPolicy = 'full' | 'collapsed' | 'partial';

export type MessageMetadata = Readonly<Record<string, unknown>>;

/**
 * Generic semantic text scope for transcript text spans.
 *
 * Built-in scopes are intentionally domain-neutral. Downstream apps can map
 * product concepts such as dialogue or narration onto these generic scopes, or
 * provide their own scope strings and CSS variables.
 */
export type TranscriptTextScope =
  | 'plain'
  | 'accent'
  | 'muted'
  | 'quote'
  | 'emphasis'
  | 'strong'
  | 'code'
  | 'success'
  | 'warning'
  | 'danger'
  | (string & {});

export interface TranscriptTextSpan {
  /** UTF-16 string offset into MessageBlock.content. */
  readonly start: number;
  /** UTF-16 string offset, exclusive. */
  readonly end: number;
  readonly scope: TranscriptTextScope;
}

// ---- attachments ----

export type AttachmentMediaKind = 'image' | 'audio' | 'video' | 'file';
export type AttachmentLifecycleStatus = 'active' | 'removed';
export type AttachmentContentState =
  | 'available'
  | 'unavailable'
  | 'unsupported'
  | 'empty'
  | 'oversized'
  | 'failed';
export type AttachmentContentLoadPolicy = 'direct' | 'authenticated_lazy';

export interface AttachmentTextPreview {
  readonly text: string;
  readonly truncated: boolean;
  readonly language?: string;
}

export interface ChatAttachment {
  readonly id: string;
  readonly status?: AttachmentLifecycleStatus;
  readonly kind: AttachmentMediaKind;
  readonly name: string;
  readonly mimeType: string | undefined;
  readonly sizeBytes: number | undefined;
  readonly url: string | undefined;
  readonly thumbnailUrl: string | undefined;
  readonly contentState?: AttachmentContentState;
  readonly contentLoadPolicy?: AttachmentContentLoadPolicy;
  readonly contentSha256?: string;
  readonly width?: number;
  readonly height?: number;
  readonly textPreview: AttachmentTextPreview | undefined;
  readonly scopeId: string | undefined;
  readonly metadata?: MessageMetadata;
}

export interface ChatAttachmentLink {
  readonly id: string;
  readonly attachmentId: string;
  readonly messageId: string | undefined;
  readonly blockId: string | undefined;
  readonly scopeId: string | undefined;
  readonly createdAt: string;
  readonly metadata?: MessageMetadata;
}

/**
 * Durable attachment state retained by the event projection. Keeping links
 * outside rendered messages lets link events arrive before their target
 * message, then materialize the same stable block once that message appears.
 */
export interface ChatAttachmentProjection {
  readonly attachment: ChatAttachment;
  readonly links: readonly ChatAttachmentLink[];
  readonly updatedAt: string;
}

export interface ChatAttachmentScope {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly accept?: string;
  readonly multiple?: boolean;
  readonly metadata?: MessageMetadata;
}

/** Lifecycle status of a tool-call or command block. */
export type ToolBlockStatus = 'started' | 'running' | 'completed' | 'failed';

/**
 * Metadata for an inline tool-call / command block. Present on blocks of kind
 * `tool_call` or `command`; absent on text blocks. The renderer uses it to draw
 * a header (name + status) while the block `content` holds the (collapsible)
 * detail/result.
 */
export interface ToolBlockMeta {
  readonly name: string;
  readonly status: ToolBlockStatus;
  readonly summary: string;
  readonly reasonCode: string | undefined;
  readonly debugDetailId: string | undefined;
}

/**
 * A renderable block within a message. Messages contain multiple blocks so the
 * transcript renderer can virtualize, collapse, and partial-render long content.
 * Tool-call and command activity is interleaved as blocks (in event order) so it
 * renders inline in the transcript. The renderer fills in `estimatedHeight` after
 * measuring; it is absent until then.
 */
export interface MessageBlock {
  readonly id: string;
  readonly messageId: string;
  readonly kind: MessageBlockKind;
  readonly content: string;
  readonly estimatedHeight: number | undefined;
  readonly renderPolicy: RenderPolicy;
  /** Present for `tool_call` / `command` blocks; absent for text blocks. */
  readonly tool?: ToolBlockMeta;
  /** Optional semantic spans for text blocks. Ignored for non-text blocks. */
  readonly textSpans?: readonly TranscriptTextSpan[];
  readonly attachment?: ChatAttachment;
  readonly attachments?: readonly ChatAttachment[];
  readonly metadata?: MessageMetadata;
}

// ---- messages ----

export type MessageStatus = 'streaming' | 'completed' | 'error';

export interface ChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly author: MessageAuthor;
  readonly createdAt: string;
  readonly status: MessageStatus;
  readonly blocks: readonly MessageBlock[];
  readonly tree?: MessageTreePosition;
  readonly metadata?: MessageMetadata;
}

export interface MessageTreePosition {
  readonly branchId: string | undefined;
  readonly parentMessageId: string | undefined;
  readonly previousMessageId: string | undefined;
  readonly snapshotIds: readonly string[];
}

// ---- message alternates ----

export type MessageVariantSource = 'primary' | 'alternate';

/**
 * One complete renderable variant for a stable transcript slot.
 *
 * Variants intentionally carry a full ChatMessage rather than only replacement
 * text. That preserves message metadata, block boundaries, block metadata, and
 * mixed text/tool/debug content for every alternate.
 */
export interface MessageVariant {
  readonly id: string;
  readonly slotId: string;
  readonly source: MessageVariantSource;
  readonly ordinal: number;
  readonly message: ChatMessage;
  readonly metadata?: MessageMetadata;
}

/**
 * Stable transcript position with one primary message and zero or more ordered
 * alternates. A renderer can track `id` for virtualization/scroll anchoring
 * while swapping the active variant locally.
 */
export interface MessageAlternateSlot {
  readonly id: string;
  readonly sessionId: string;
  readonly primary: MessageVariant;
  readonly alternates: readonly MessageVariant[];
  readonly activeVariantId: string | undefined;
  readonly metadata?: MessageMetadata;
}

// ---- tool calls ----

export type ToolCallStatus = 'started' | 'completed' | 'failed';

export interface ToolCallProjection {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly summary: string;
  readonly status: ToolCallStatus;
  readonly resultRef: Readonly<Record<string, unknown>> | undefined;
  readonly reasonCode: string | undefined;
  readonly debugDetailId: string | undefined;
  readonly eventId: string;
  readonly createdAt: string;
}

export type ToolCallDebugDetail = ProtocolToolCallDebugDetail;
export type ToolCallDebugValue = ProtocolToolCallDebugValue;

// ---- commands ----

export type CommandStatus = 'started' | 'completed' | 'failed';

export interface CommandProjection {
  readonly commandName: string;
  readonly summary: string;
  readonly status: CommandStatus;
  readonly oldSessionId: string | undefined;
  readonly newSessionId: string | undefined;
  readonly reasonCode: string | undefined;
  readonly eventId: string;
  readonly createdAt: string;
}

// ---- active assistant turn ----

export interface ActiveAssistantTurn {
  readonly startedAt: string;
  readonly messageId: string | undefined;
  readonly streamingText: string;
}

// ---- branches / checkpoints (frontend extension points) ----

/**
 * Branch and checkpoint types are frontend extension points. The current backend
 * v0 contract does not emit branch/retry/fork events. These types exist so the
 * domain can model them when/if the backend adds support.
 */
export interface ConversationBranch {
  readonly id: string;
  readonly sessionId?: string;
  readonly parentBranchId?: string;
  readonly parentMessageId: string | undefined;
  readonly originMessageId?: string;
  readonly headMessageId?: string;
  readonly label: string | undefined;
  readonly createdAt: string;
  readonly metadata?: MessageMetadata;
}

export interface ConversationSnapshot {
  readonly id: string;
  readonly sessionId?: string;
  readonly branchId?: string;
  readonly messageId: string | undefined;
  readonly cursor?: string;
  readonly label: string | undefined;
  readonly summary: string | undefined;
  readonly createdAt: string;
  readonly metadata?: MessageMetadata;
}

export interface SummaryCheckpoint extends ConversationSnapshot {
  readonly cursor: string;
  readonly summary: string;
}

// ---- context strategy / compaction status (tasks #3788/#3846/#3847) ----

/** Quality of a context-usage token estimate, mirroring the wire enum. */
export type ContextEstimateQuality = 'exact' | 'approximate' | 'unavailable';

/**
 * Which `context_*` event produced a {@link ContextTimelineEntry}. Mirrors the
 * four browser-safe context event kinds the backend emits.
 */
export type ContextTimelineKind =
  | 'status'
  | 'compaction_started'
  | 'compaction_completed'
  | 'compaction_failed';

/**
 * A projected context strategy / compaction status row.
 *
 * These are produced from the four `context_*` events (which the backend marks
 * `ui_debug: true` / `model_facing: false`). They render as UI/debug status
 * rows, visually distinct from assistant transcript content, and are NEVER
 * folded into messages — the backend never sends summary text here, only
 * browser-safe metadata.
 */
export interface ContextTimelineEntry {
  readonly id: string;
  readonly kind: ContextTimelineKind;
  readonly sessionId: string;
  readonly wakeId: string | undefined;
  readonly strategyId: string;
  readonly estimateQuality: ContextEstimateQuality | undefined;
  readonly fillPercent: number | undefined;
  readonly compactAtPercent: number | undefined;
  readonly targetPercentAfterCompaction: number | undefined;
  readonly artifactId: string | undefined;
  readonly reasonCode: string | undefined;
  readonly createdAt: string;
}

// ---- logical-turn lifecycle ----

/**
 * One Rust-owned logical assistant turn across any number of provider wake
 * continuations. This is operator/debug state and never transcript content.
 */
export interface LogicalTurnProjection {
  readonly id: string;
  readonly sessionId: string;
  readonly projectionId: string;
  readonly currentContinuationId: string;
  readonly continuationCount: number;
  readonly executionEpochId: string | undefined;
  readonly wakeId: string;
  readonly phase: LogicalTurnPhase;
  readonly operatorState: LogicalTurnOperatorState;
  readonly progressClassification: LogicalTurnProgressClassification;
  readonly reasonCode: string;
  readonly summary: string;
  readonly progress: LogicalTurnProgress;
  readonly revision: number;
  readonly eventId: string;
  readonly updatedAt: string;
}

// ---- the projection ----

export interface StreamErrorState {
  readonly message: string;
  readonly reasonCode: string | undefined;
  readonly retryable: boolean;
  readonly eventId: string;
}

/**
 * The frontend view-model produced by reducing protocol ChatEvents.
 *
 * This is what the chat-store holds and the transcript-renderer renders. It is
 * NOT the wire format — the wire format is ChatEvent from @rusty-view/protocol.
 */
export interface ConversationProjection {
  readonly messages: readonly ChatMessage[];
  readonly attachments: readonly ChatAttachmentProjection[];
  readonly toolCalls: readonly ToolCallProjection[];
  readonly commands: readonly CommandProjection[];
  readonly branches: readonly ConversationBranch[];
  readonly snapshots: readonly ConversationSnapshot[];
  readonly checkpoints: readonly SummaryCheckpoint[];
  readonly latestCursor: string | undefined;
  readonly activeTurn: ActiveAssistantTurn | undefined;
  readonly unknownEvents: readonly ChatEvent[];
  readonly sessionMetadata: ChatSessionSummary | undefined;
  readonly streamError: StreamErrorState | undefined;
  /**
   * Context strategy / compaction status rows in event order (oldest first),
   * projected from the four `context_*` events. Rendered as UI/debug status
   * rows, not assistant messages.
   */
  readonly contextTimeline: readonly ContextTimelineEntry[];
  /** The most recent context status/compaction row, for at-a-glance display. */
  readonly contextStatus: ContextTimelineEntry | undefined;
  /** Rust-owned lifecycle state, one row per logical turn. */
  readonly logicalTurns: readonly LogicalTurnProjection[];
}

/** An empty projection — the starting point before any events are applied. */
export function emptyProjection(): ConversationProjection {
  return {
    messages: [],
    attachments: [],
    toolCalls: [],
    commands: [],
    branches: [],
    snapshots: [],
    checkpoints: [],
    latestCursor: undefined,
    activeTurn: undefined,
    unknownEvents: [],
    sessionMetadata: undefined,
    streamError: undefined,
    contextTimeline: [],
    contextStatus: undefined,
    logicalTurns: [],
  };
}
