import { Injectable } from '@angular/core';
import type {
  UserIdentitySettings,
  UserIdentitySettingsStorage,
} from '@rusty-view/chat-store';

/** IndexedDB persistence for the local operator's soft chat identity. */
@Injectable()
export class IndexedDbUserIdentitySettingsStorage
  implements UserIdentitySettingsStorage
{
  private dbPromise: Promise<IDBDatabase> | undefined;

  async load(): Promise<unknown | null> {
    try {
      const db = await this.database();
      return await new Promise<unknown | null>((resolve, reject) => {
        const request = db
          .transaction('preferences', 'readonly')
          .objectStore('preferences')
          .get('user-identity');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  async save(settings: UserIdentitySettings): Promise<void> {
    try {
      const db = await this.database();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('preferences', 'readwrite');
        transaction.objectStore('preferences').put(settings, 'user-identity');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch {
      // Persistence is best-effort; the live setting still reflects the change.
    }
  }

  private database(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rusty-view-preferences', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('preferences')) {
          request.result.createObjectStore('preferences');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }
}
