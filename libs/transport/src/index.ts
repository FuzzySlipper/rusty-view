/**
 * @rusty-view/transport
 *
 * HTTP/SSE client for the Rusty Crew chat session API. Owns fetch + EventSource
 * + abort/reconnect mechanics. Framework-agnostic: no Angular, no components.
 * The shell/container layer calls into transport and feeds events into the
 * chat-store; transport never holds session state and never knows about
 * roleplay concepts.
 *
 * Implemented in Den task #3181. This file is the public API entrypoint only.
 */
export const TRANSPORT_VERSION = '0.0.0' as const;
