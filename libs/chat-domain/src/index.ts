/**
 * @rusty-view/chat-domain
 *
 * Pure TypeScript chat domain logic: conversation projection from the protocol
 * event log, event reduction, message/block modeling, branch/session modeling,
 * cursor/summary-checkpoint concepts. No Angular, no network calls, no I/O.
 * Depends only on @rusty-view/protocol.
 *
 * Implemented in Den task #3182. This file is the public API entrypoint only.
 */
export const CHAT_DOMAIN_VERSION = '0.0.0' as const;
