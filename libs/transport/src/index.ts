/**
 * @rusty-view/transport
 *
 * HTTP/SSE client for the Rusty Crew chat session API. Owns ALL backend
 * communication: session list/open, event replay, send-message, command
 * registry/execute (HTTP), and live event streaming (fetch-based SSE with
 * cursor resume + bounded exponential backoff reconnection).
 *
 * Framework-neutral: no Angular, no components, no roleplay concepts. The
 * Angular chat-store adapts transport's connection state to Signals.
 *
 * Protocol types come from @rusty-view/protocol (generated from OpenAPI).
 * No generated HTTP client — fetch/SSE handling is hand-written and explicit
 * for full control over auth, CORS, reconnect, cursor, and debug behavior.
 *
 * Implemented in Den task #3181.
 */

export { ChatTransport } from './lib/chat-transport';
export type { StreamEventsOptions } from './lib/chat-transport';

export { ChatHttpTransport } from './lib/chat-http-transport';
export type {
  ListSessionsQuery,
  OpenSessionQuery,
  ReplayEventsQuery,
} from './lib/chat-http-transport';
export { AdminHttpTransport } from './lib/admin-http-transport';
export type { AdminListQuery } from './lib/admin-http-transport';
export type {
  AdminAgentDiagnostics,
  AdminApiEnvelope,
  ApiCapabilityDescriptor,
  ApiCapabilityRegistry,
  AdminControlOutcome,
  AdminControlResponse,
  AdminDiagnosticsBundle,
  AdminDiagnosticsOverview,
  AdminPage,
  AdminProfileAssetStatus,
  AdminProfileRegistryAssetStatus,
  AdminProfileRegistryDiagnostics,
  AdminProfileRegistryQuery,
  AdminProfileRegistryRecord,
  AdminProfileRegistrySource,
  CreateAdminProfileRequest,
  CreatedProfileRuntimeAction,
  CreatedServiceProfile,
  McpSurfaceDiagnostics,
  ProfileBundleExportEntry,
  ProfileBundleExportEntryKind,
  ProfileBundleExportPlan,
  ProfileBundleExportSource,
  ProfileRegistryDerivedRuntimeRef,
  ProfileRegistrySourceAssetRef,
  RuntimeBrainModuleDiagnostics,
  RuntimeConfigApplyResult,
  RuntimeConfigDiagnostic,
  RuntimeConfigValidationReport,
  RuntimePauseControlRequest,
  RuntimePauseControlResult,
  RuntimePauseDiagnostics,
  RuntimePauseScope,
  RuntimeResumeNoopResult,
  RuntimeSessionDiagnostics,
} from './lib/admin-api-types';

export { ChatEventStream } from './lib/chat-event-stream';
export type {
  ChatEventStreamOptions,
  SleepFunction,
} from './lib/chat-event-stream';
export { calculateBackoffDelay, defaultSleep } from './lib/chat-event-stream';

export type {
  ChatConnectionState,
  ConnectionStateListener,
  Unsubscribe,
} from './lib/connection-state';

export {
  ChatTransportError,
  classifyFetchError,
  toChatTransportError,
} from './lib/chat-transport-error';
export type {
  ChatTransportErrorCode,
  ChatTransportErrorInit,
} from './lib/chat-transport-error';

export type {
  ChatTransportConfig,
  ChatTransportConfigInput,
  FetchImpl,
} from './lib/chat-transport-config';
export { resolveChatTransportConfig } from './lib/chat-transport-config';

export const TRANSPORT_VERSION = '0.0.0' as const;
