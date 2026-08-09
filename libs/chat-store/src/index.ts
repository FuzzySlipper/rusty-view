/**
 * @rusty-view/chat-store
 *
 * Angular Signals store for chat session state: current session, message
 * projection (via chat-domain reducer), stream status, connection state, raw
 * event log, command registry, and pending sends. No product-specific state.
 *
 * All network communication goes through @rusty-view/transport. All durable
 * storage goes through a ChatStorageAdapter (provided via CHAT_STORAGE_ADAPTER
 * injection token — typically IndexedDbChatStorage).
 *
 * Implemented in Den task #3183.
 */

export { ChatStore, CHAT_STORAGE_ADAPTER } from './lib/chat-store';
export { AdminStore } from './lib/admin-store';
export { SwitchboardStore } from './lib/switchboard-store';
export {
  buildSwitchboardTargetOptions,
  deliveryOutcome,
  normalizeSwitchboardOutcome,
  projectSwitchboardRouteRows,
  targetKey,
  validateSwitchboardDraft,
} from './lib/switchboard-model';
export type { SwitchboardActionResult } from './lib/switchboard-store';
export type {
  SwitchboardDraftValidation,
  SwitchboardOutcomeKind,
  SwitchboardRouteDraft,
  SwitchboardRouteRow,
  SwitchboardTargetOption,
} from './lib/switchboard-model';
export {
  createExternalAgentRequestKey,
  ExternalAgentStore,
  filterExternalAgentSessions,
  isActiveExternalSession,
} from './lib/external-agent-store';
export type {
  ExternalAgentInventoryMode,
  ExternalAgentProfileOption,
  ExternalAgentSession,
  ExternalComposerMode,
  ExternalLineageTransition,
} from './lib/external-agent-store';
export type { AdminProfileSummary } from './lib/admin-store';
export {
  INITIAL_RUNTIME_ACTIVITY_FINDING_CODES,
  projectRuntimeActivityRows,
  runtimeActivityFindingLabel,
  runtimeActivityKindLabel,
  runtimeActivityOwnerLabel,
} from './lib/runtime-activity-model';
export type { RuntimeActivityRow } from './lib/runtime-activity-model';
export {
  storeErrorDetail,
  storeErrorDetailMessage,
  storeErrorMessage,
} from './lib/store-error';
export type { StoreApiErrorDetail, StoreErrorDetail } from './lib/store-error';
export { IndexedDbChatStorage } from './lib/indexed-db-chat-storage';
export type { PendingSend } from './lib/pending-operations';

export const CHAT_STORE_VERSION = '0.0.0' as const;
