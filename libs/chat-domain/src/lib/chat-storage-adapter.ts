import type { ChatEvent, ChatSessionSummary } from '@rusty-view/protocol';

/**
 * Small, roleplay-agnostic UI-state blob persisted alongside the chat cache.
 *
 * Currently holds the selected brain-profile id so the sidebar selection
 * survives refresh/reconnect, and the command history (submitted slash
 * commands) for Up/Down navigation in the composer. Optional fields keep the
 * shape forward-compatible; unknown keys are ignored by storage impls.
 */
export interface ChatUiState {
  readonly selectedProfileId?: string;
  /** Submitted slash commands, newest-first, bounded. */
  readonly commandHistory?: readonly string[];
}

/**
 * Storage adapter contract for durable chat cache.
 *
 * Defined here (in chat-domain) so the interface is shared between the
 * chat-store (#3183, which owns the IndexedDB implementation) and any future
 * storage backend. The actual IndexedDB implementation does NOT live here —
 * chat-domain is pure TypeScript with no browser APIs.
 *
 * Per docs/rusty-view.md: IndexedDB only, never localStorage/sessionStorage
 * for transcript/session data.
 */
export interface ChatStorageAdapter {
  putSession(session: ChatSessionSummary): Promise<void>;
  putEvents(sessionId: string, events: readonly ChatEvent[]): Promise<void>;
  getEvents(sessionId: string, afterCursor?: string): Promise<ChatEvent[]>;
  getSessions(): Promise<ChatSessionSummary[]>;
  clearSession(sessionId: string): Promise<void>;
  /** Load persisted UI state (selected profile, etc.), or null if none. */
  getUiState(): Promise<ChatUiState | null>;
  /** Persist UI state (merged by the caller; impls replace the blob). */
  setUiState(state: ChatUiState): Promise<void>;
}
