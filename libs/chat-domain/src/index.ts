/**
 * @rusty-view/chat-domain
 *
 * Pure TypeScript domain logic for rusty-view: conversation projection from the
 * protocol event log, event reduction, message/block modeling, branch/session
 * modeling, and the storage adapter interface.
 *
 * No Angular, no network calls, no I/O, no browser APIs. Depends only on
 * @rusty-view/protocol. The Angular chat-store (#3183) wraps this in Signals.
 *
 * Implemented in Den task #3182.
 */

export { projectConversation } from './lib/conversation-projection';
export { emptyProjection } from './lib/domain-types';
export { projectProfile, projectProfiles } from './lib/brain-profile';
export {
  activeMessageForSlot,
  activeMessageVariant,
  findMessageVariant,
  messageAlternateSlot,
  orderedMessageVariants,
  primaryMessageVariant,
  withActiveMessageVariant,
} from './lib/message-alternates';

export type {
  MessageRole,
  MessageAuthor,
  KnownMessageBlockKind,
  MessageBlockKind,
  RenderPolicy,
  MessageMetadata,
  ToolBlockStatus,
  ToolBlockMeta,
  MessageBlock,
  MessageStatus,
  ChatMessage,
  MessageVariantSource,
  MessageVariant,
  MessageAlternateSlot,
  ToolCallStatus,
  ToolCallProjection,
  CommandStatus,
  CommandProjection,
  ActiveAssistantTurn,
  ConversationBranch,
  SummaryCheckpoint,
  StreamErrorState,
  ConversationProjection,
} from './lib/domain-types';
export type { MessageAlternateSlotOptions } from './lib/message-alternates';

export type {
  ChatStorageAdapter,
  ChatUiState,
} from './lib/chat-storage-adapter';
export type { BrainProfile, BrainProfileStatus } from './lib/brain-profile';

export const CHAT_DOMAIN_VERSION = '0.0.0' as const;
