/**
 * @rusty-view/chat-store
 *
 * Angular Signals store for chat session state: current session, message
 * projection, stream status, and connection status. Transport-agnostic by
 * design — the shell/container layer feeds transport events into the store; the
 * store makes no network calls and holds no roleplay state. Depends on
 * @rusty-view/protocol and @rusty-view/chat-domain.
 *
 * Implemented in Den task #3183. This file is the public API entrypoint only.
 */
export const CHAT_STORE_VERSION = '0.0.0' as const;
