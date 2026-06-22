/**
 * @rusty-view/chat-components
 *
 * Dumb presentational components: message bubble, message input, stream-status
 * indicator, retry button, tool-call panel, raw JSON inspector. Inputs/outputs
 * only — no service injection, no store access, no domain logic. Each component
 * must have empty/loading/error/long-content states where relevant. Depends on
 * @rusty-view/protocol and @rusty-view/chat-domain.
 *
 * Implemented in Den task #3185. This file is the public API entrypoint only.
 */
export const CHAT_COMPONENTS_VERSION = '0.0.0' as const;
