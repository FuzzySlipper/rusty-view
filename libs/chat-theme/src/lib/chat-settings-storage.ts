import { Injectable, InjectionToken } from '@angular/core';

import type { AppearanceSettings } from './appearance-settings';

/**
 * Storage adapter contract for appearance settings.
 *
 * Distinct from the chat-cache {@code ChatStorageAdapter} (sessions/events):
 * this persists only the small appearance preferences object. Like the chat
 * cache it MUST use IndexedDB, never `localStorage`/`sessionStorage`, per
 * docs/rusty-view.md storage rules. A concrete IndexedDB implementation is
 * provided by {@link IndexedDbChatSettingsStorage}; tests/embedders may supply
 * an in-memory implementation.
 */
export interface ChatSettingsStorage {
  load(): Promise<AppearanceSettings | null>;
  save(settings: AppearanceSettings): Promise<void>;
}

/**
 * DI token for {@link ChatSettingsStorage}. The shell/app provides a concrete
 * implementation. Falls back to a no-op in-memory store when none is provided
 * (so the theme service never crashes on boot), but production wiring should
 * always supply the IndexedDB implementation.
 */
export const CHAT_SETTINGS_STORAGE = new InjectionToken<ChatSettingsStorage>(
  'CHAT_SETTINGS_STORAGE',
);

/** Simple in-memory implementation, useful for tests and SSR. */
@Injectable()
export class InMemoryChatSettingsStorage implements ChatSettingsStorage {
  private value: AppearanceSettings | null = null;

  async load(): Promise<AppearanceSettings | null> {
    return this.value;
  }

  async save(settings: AppearanceSettings): Promise<void> {
    this.value = settings;
  }
}

const DB_NAME = 'rusty-view-chat';
const DB_VERSION = 3;
const SETTINGS_STORE = 'settings';
const SETTINGS_KEY = 'appearance';
const UI_STATE_STORE = 'ui_state';

/**
 * Ensure the full shared schema exists. The `rusty-view-chat` database is also
 * opened by `@rusty-view/chat-store` (for `sessions`/`events`). Whichever
 * connection triggers an upgrade must create every known store, so the other
 * connection never sees a missing store. Idempotent.
 */
function ensureSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('sessions')) {
    db.createObjectStore('sessions', { keyPath: 'session_id' });
  }
  if (!db.objectStoreNames.contains('events')) {
    const eventStore = db.createObjectStore('events', {
      keyPath: ['session_id', 'sequence_id'],
    });
    eventStore.createIndex('by_session', 'session_id', { unique: false });
  }
  if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
    db.createObjectStore(SETTINGS_STORE);
  }
  if (!db.objectStoreNames.contains(UI_STATE_STORE)) {
    db.createObjectStore(UI_STATE_STORE);
  }
}

/**
 * IndexedDB-backed {@link ChatSettingsStorage}.
 *
 * Shares the `rusty-view-chat` database with the chat cache (a separate
 * `settings` object store, keyed by a single fixed key). Persists only the
 * appearance preferences object — no tokens, no auth, no transcript data.
 */
@Injectable()
export class IndexedDbChatSettingsStorage implements ChatSettingsStorage {
  private dbPromise: Promise<IDBDatabase> | undefined;

  async load(): Promise<AppearanceSettings | null> {
    try {
      const db = await this.getDb();
      return await new Promise<AppearanceSettings | null>((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE, 'readonly');
        const store = tx.objectStore(SETTINGS_STORE);
        const request = store.get(SETTINGS_KEY);
        request.onsuccess = () =>
          resolve(
            request.result === undefined
              ? null
              : (request.result as AppearanceSettings),
          );
        request.onerror = () =>
          reject(request.error ?? new Error('Settings load failed'));
      });
    } catch {
      // Storage failures are non-fatal — fall back to defaults.
      return null;
    }
  }

  async save(settings: AppearanceSettings): Promise<void> {
    try {
      const db = await this.getDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE, 'readwrite');
        tx.objectStore(SETTINGS_STORE).put(settings, SETTINGS_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error('Settings save failed'));
        tx.onabort = () =>
          reject(tx.error ?? new Error('Settings save aborted'));
      });
    } catch {
      // Non-fatal: in-memory state still reflects the change for this session.
    }
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise !== undefined) {
      return this.dbPromise;
    }
    this.dbPromise = this.openDb();
    return this.dbPromise;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        ensureSchema(request.result);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB open failed'));
    });
  }
}
