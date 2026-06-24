import type { ChatEvent, ChatSessionSummary } from '@rusty-view/protocol';
import type { ChatStorageAdapter } from '@rusty-view/chat-domain';

const DB_NAME = 'rusty-view-chat';
const DB_VERSION = 2;
const SESSIONS_STORE = 'sessions';
const EVENTS_STORE = 'events';
const SETTINGS_STORE = 'settings';

/**
 * Ensure the full shared schema exists. The `rusty-view-chat` database is also
 * opened by `@rusty-view/chat-theme` (for the `settings` store). Whichever
 * connection triggers an upgrade must create every known store, so the other
 * connection never sees a missing store. Idempotent: only creates what's
 * absent.
 */
function ensureSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
    db.createObjectStore(SESSIONS_STORE, { keyPath: 'session_id' });
  }
  if (!db.objectStoreNames.contains(EVENTS_STORE)) {
    const eventStore = db.createObjectStore(EVENTS_STORE, {
      keyPath: ['session_id', 'sequence_id'],
    });
    eventStore.createIndex('by_session', 'session_id', { unique: false });
  }
  if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
    db.createObjectStore(SETTINGS_STORE);
  }
}

/**
 * IndexedDB-backed implementation of {@link ChatStorageAdapter}.
 *
 * Persists protocol wire events and session summaries for durable cache across
 * browser refreshes. Never persists bearer tokens or auth material (those live
 * only in the transport config).
 *
 * Object stores:
 *   - sessions: keyPath = 'session_id'
 *   - events:   keyPath = ['session_id', 'sequence_id'], index on 'session_id'
 */
export class IndexedDbChatStorage implements ChatStorageAdapter {
  private dbPromise: Promise<IDBDatabase> | undefined;

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise !== undefined) {
      return this.dbPromise;
    }
    this.dbPromise = this.openDb();
    return this.dbPromise;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        ensureSchema(request.result);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB open failed'));
    });
  }

  async putSession(session: ChatSessionSummary): Promise<void> {
    const db = await this.getDb();
    await this.writeTransaction(db, SESSIONS_STORE, (store) => {
      store.put(session);
    });
  }

  async putEvents(
    sessionId: string,
    events: readonly ChatEvent[],
  ): Promise<void> {
    if (events.length === 0) return;
    const db = await this.getDb();
    await this.writeTransaction(db, EVENTS_STORE, (store) => {
      for (const event of events) {
        if (event.session_id === sessionId) {
          store.put(event);
        }
      }
    });
  }

  async getEvents(
    sessionId: string,
    afterCursor?: string,
  ): Promise<ChatEvent[]> {
    const db = await this.getDb();
    return new Promise<ChatEvent[]>((resolve, reject) => {
      const tx = db.transaction(EVENTS_STORE, 'readonly');
      const store = tx.objectStore(EVENTS_STORE);
      const index = store.index('by_session');
      const range = IDBKeyRange.only(sessionId);
      const results: ChatEvent[] = [];
      let pastCursor = afterCursor === undefined;
      const cursorRequest = index.openCursor(range, 'next');

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) {
          resolve(results);
          return;
        }
        const event = cursor.value as ChatEvent;
        if (!pastCursor) {
          if (event.event_id === afterCursor) {
            pastCursor = true;
          }
        } else {
          results.push(event);
        }
        cursor.continue();
      };
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error('Event cursor failed'));
    });
  }

  async getSessions(): Promise<ChatSessionSummary[]> {
    const db = await this.getDb();
    return new Promise<ChatSessionSummary[]>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, 'readonly');
      const store = tx.objectStore(SESSIONS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as ChatSessionSummary[]);
      request.onerror = () =>
        reject(request.error ?? new Error('getAll sessions failed'));
    });
  }

  async clearSession(sessionId: string): Promise<void> {
    const db = await this.getDb();

    // Delete session record.
    await this.writeTransaction(db, SESSIONS_STORE, (store) => {
      store.delete(sessionId);
    });

    // Delete all events for this session via cursor.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(EVENTS_STORE, 'readwrite');
      const store = tx.objectStore(EVENTS_STORE);
      const index = store.index('by_session');
      const range = IDBKeyRange.only(sessionId);
      const cursorRequest = index.openCursor(range);

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error('Clear session events failed'));
      tx.onabort = () =>
        reject(tx.error ?? new Error('Clear session events aborted'));
    });
  }

  /** Run a write transaction and resolve when it completes. */
  private writeTransaction(
    db: IDBDatabase,
    storeName: string,
    fn: (store: IDBObjectStore) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      try {
        fn(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error('Write transaction failed'));
      tx.onabort = () =>
        reject(tx.error ?? new Error('Write transaction aborted'));
    });
  }
}
