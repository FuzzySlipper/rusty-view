import type { ChatEvent, ChatSessionSummary } from '@rusty-view/protocol';

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
}
