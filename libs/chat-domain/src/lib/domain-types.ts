import type { ChatEvent, ChatSessionSummary } from '@rusty-view/protocol';

/**
 * @rusty-view/chat-domain domain types.
 *
 * These are FRONTEND domain/view-model types, not wire types. Wire types live in
 * @rusty-view/protocol. The {@link projectConversation} reducer converts
 * protocol ChatEvents into these view-model types.
 */

// ---- message author ----

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface MessageAuthor {
  readonly role: MessageRole;
  readonly displayName: string | undefined;
}

// ---- message blocks ----

export type KnownMessageBlockKind =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'debug'
  | 'command';

export type MessageBlockKind = KnownMessageBlockKind | (string & {});

export type RenderPolicy = 'full' | 'collapsed' | 'partial';

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
  readonly eventId: string;
  readonly createdAt: string;
}

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
  readonly parentMessageId: string | undefined;
  readonly label: string | undefined;
  readonly createdAt: string;
}

export interface SummaryCheckpoint {
  readonly id: string;
  readonly cursor: string;
  readonly summary: string;
  readonly createdAt: string;
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
  readonly toolCalls: readonly ToolCallProjection[];
  readonly commands: readonly CommandProjection[];
  readonly branches: readonly ConversationBranch[];
  readonly checkpoints: readonly SummaryCheckpoint[];
  readonly latestCursor: string | undefined;
  readonly activeTurn: ActiveAssistantTurn | undefined;
  readonly unknownEvents: readonly ChatEvent[];
  readonly sessionMetadata: ChatSessionSummary | undefined;
  readonly streamError: StreamErrorState | undefined;
}

/** An empty projection — the starting point before any events are applied. */
export function emptyProjection(): ConversationProjection {
  return {
    messages: [],
    toolCalls: [],
    commands: [],
    branches: [],
    checkpoints: [],
    latestCursor: undefined,
    activeTurn: undefined,
    unknownEvents: [],
    sessionMetadata: undefined,
    streamError: undefined,
  };
}
