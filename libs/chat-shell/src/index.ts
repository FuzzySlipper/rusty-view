/**
 * @rusty-view/chat-shell
 *
 * Higher-level layout/container pieces for the debug app: session list,
 * transcript region, inspector panels, and command composer. The shell is the
 * composition layer — it wires transport events into the chat-store and renders
 * chat-components and the transcript-renderer. It is the only place that may
 * depend on transport + store + components together.
 *
 * Implemented in Den task #3185. This file is the public API entrypoint only.
 */
export const CHAT_SHELL_VERSION = '0.0.0' as const;
