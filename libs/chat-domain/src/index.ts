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
export { projectExternalAgentTranscript } from './lib/external-agent-projection';
export { emptyProjection } from './lib/domain-types';
export { projectProfile, projectProfiles } from './lib/brain-profile';
export {
  branchBreadcrumbs,
  branchJumpTarget,
  messageJumpTarget,
  snapshotJumpTarget,
} from './lib/conversation-navigation';
export { searchConversationMessages } from './lib/conversation-search';
export { attachmentKindForMimeType } from './lib/attachments';
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
  MessageSpeakerIdentity,
  KnownMessageBlockKind,
  MessageBlockKind,
  RenderPolicy,
  MessageMetadata,
  TranscriptTextScope,
  TranscriptTextSpan,
  AttachmentMediaKind,
  AttachmentLifecycleStatus,
  AttachmentTextPreview,
  ChatAttachment,
  ChatAttachmentLink,
  ChatAttachmentProjection,
  ChatAttachmentScope,
  ToolBlockStatus,
  ToolBlockMeta,
  MessageBlock,
  MessageStatus,
  ChatMessage,
  MessageTreePosition,
  MessageVariantSource,
  MessageVariant,
  MessageAlternateSlot,
  ToolCallStatus,
  ToolCallProjection,
  ToolCallDebugDetail,
  ToolCallDebugValue,
  CommandStatus,
  CommandProjection,
  ContextEstimateQuality,
  ContextTimelineKind,
  ContextTimelineEntry,
  ActiveAssistantTurn,
  ConversationBranch,
  ConversationSnapshot,
  SummaryCheckpoint,
  StreamErrorState,
  ConversationProjection,
} from './lib/domain-types';
export type {
  ConversationBranchBreadcrumb,
  ConversationNavigationTarget,
  ConversationNavigationTargetKind,
} from './lib/conversation-navigation';
export type {
  ConversationSearchFilters,
  ConversationSearchResult,
} from './lib/conversation-search';
export type { MessageAlternateSlotOptions } from './lib/message-alternates';

export type {
  ChatStorageAdapter,
  ChatUiState,
} from './lib/chat-storage-adapter';
export type { BrainProfile, BrainProfileStatus } from './lib/brain-profile';

export const CHAT_DOMAIN_VERSION = '0.0.0' as const;
