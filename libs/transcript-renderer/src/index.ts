/**
 * @rusty-view/transcript-renderer
 *
 * Virtualized transcript rendering: dynamic message-height handling, scroll
 * anchoring, tail-follow, jump-to-message, long-message block rendering, and
 * streaming-delta patching. Roleplay-agnostic. Must survive 10k+ messages with
 * no full-transcript re-render on token deltas. Depends on
 * @rusty-view/protocol and @rusty-view/chat-domain.
 *
 * Implemented in Den task #3184. This file is the public API entrypoint only.
 */
export const TRANSCRIPT_RENDERER_VERSION = '0.0.0' as const;
