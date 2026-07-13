import { Injectable, InjectionToken, inject, signal } from '@angular/core';

export type HotkeyAction =
  | 'nextSession'
  | 'previousSession'
  | 'erasePreviousWord';

export interface HotkeySettings {
  readonly version: 1;
  readonly bindings: Readonly<Record<HotkeyAction, string>>;
}

export const DEFAULT_HOTKEY_SETTINGS: HotkeySettings = {
  version: 1,
  bindings: {
    nextSession: 'Ctrl+Tab',
    previousSession: 'Ctrl+Shift+Tab',
    erasePreviousWord: 'Ctrl+W',
  },
};

export const HOTKEY_ACTIONS: readonly {
  readonly id: HotkeyAction;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: 'nextSession',
    label: 'Next session',
    description: 'Cycle forward through the active Profiles or Agents list.',
  },
  {
    id: 'previousSession',
    label: 'Previous session',
    description: 'Cycle backward through the active Profiles or Agents list.',
  },
  {
    id: 'erasePreviousWord',
    label: 'Erase previous word',
    description:
      'Delete the previous word while the message composer is focused.',
  },
];

export interface HotkeySettingsStorage {
  load(): Promise<unknown | null>;
  save(settings: HotkeySettings): Promise<void>;
}

export const HOTKEY_SETTINGS_STORAGE =
  new InjectionToken<HotkeySettingsStorage>('HOTKEY_SETTINGS_STORAGE');

@Injectable()
export class IndexedDbHotkeySettingsStorage implements HotkeySettingsStorage {
  private dbPromise: Promise<IDBDatabase> | undefined;

  async load(): Promise<unknown | null> {
    try {
      const db = await this.database();
      return await new Promise<unknown | null>((resolve, reject) => {
        const request = db
          .transaction('preferences', 'readonly')
          .objectStore('preferences')
          .get('hotkeys');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  async save(settings: HotkeySettings): Promise<void> {
    try {
      const db = await this.database();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('preferences', 'readwrite');
        transaction.objectStore('preferences').put(settings, 'hotkeys');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch {
      // Persistence is best-effort; the live signal still reflects the change.
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

@Injectable({ providedIn: 'root' })
export class HotkeySettingsService {
  private readonly storage = inject(HOTKEY_SETTINGS_STORAGE, {
    optional: true,
  });
  private readonly current = signal<HotkeySettings>(DEFAULT_HOTKEY_SETTINGS);
  private revision = 0;
  readonly settings = this.current.asReadonly();

  constructor() {
    void this.load();
  }

  binding(action: HotkeyAction): string {
    return this.current().bindings[action];
  }

  conflictFor(action: HotkeyAction): HotkeyAction | undefined {
    const binding = this.binding(action);
    return HOTKEY_ACTIONS.find(
      (candidate) =>
        candidate.id !== action && this.binding(candidate.id) === binding,
    )?.id;
  }

  async setBinding(action: HotkeyAction, binding: string): Promise<boolean> {
    if (!isValidBinding(binding)) return false;
    const conflicts = HOTKEY_ACTIONS.some(
      (candidate) =>
        candidate.id !== action && this.binding(candidate.id) === binding,
    );
    if (conflicts) return false;
    const next: HotkeySettings = {
      version: 1,
      bindings: { ...this.current().bindings, [action]: binding },
    };
    this.revision += 1;
    this.current.set(next);
    await this.storage?.save(next);
    return true;
  }

  async reset(action: HotkeyAction): Promise<void> {
    const defaultBinding = DEFAULT_HOTKEY_SETTINGS.bindings[action];
    const bindings = { ...this.current().bindings };
    const previousBinding = bindings[action];
    const conflict = HOTKEY_ACTIONS.find(
      (candidate) =>
        candidate.id !== action && bindings[candidate.id] === defaultBinding,
    );
    bindings[action] = defaultBinding;
    if (conflict !== undefined) {
      bindings[conflict.id] = previousBinding;
    }
    const next: HotkeySettings = { version: 1, bindings };
    this.revision += 1;
    this.current.set(next);
    await this.storage?.save(next);
  }

  async resetAll(): Promise<void> {
    this.revision += 1;
    this.current.set(DEFAULT_HOTKEY_SETTINGS);
    await this.storage?.save(DEFAULT_HOTKEY_SETTINGS);
  }

  private async load(): Promise<void> {
    const revisionBeforeLoad = this.revision;
    const stored = await this.storage?.load();
    if (this.revision !== revisionBeforeLoad) return;
    this.current.set(normalizeHotkeySettings(stored));
  }
}

export function normalizeHotkeySettings(value: unknown): HotkeySettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_HOTKEY_SETTINGS;
  }
  const record = value as Record<string, unknown>;
  if (record['version'] !== 1) return DEFAULT_HOTKEY_SETTINGS;
  const bindings = record['bindings'];
  if (typeof bindings !== 'object' || bindings === null) {
    return DEFAULT_HOTKEY_SETTINGS;
  }
  const candidate = bindings as Record<string, unknown>;
  const normalized: Record<HotkeyAction, string> = {
    ...DEFAULT_HOTKEY_SETTINGS.bindings,
  };
  for (const action of HOTKEY_ACTIONS) {
    const binding = candidate[action.id];
    if (typeof binding === 'string' && isValidBinding(binding)) {
      normalized[action.id] = binding;
    }
  }
  if (new Set(Object.values(normalized)).size !== HOTKEY_ACTIONS.length) {
    return DEFAULT_HOTKEY_SETTINGS;
  }
  return { version: 1, bindings: normalized };
}

function isValidBinding(binding: string): boolean {
  if (binding.length === 0 || binding.length > 80) return false;
  const parts = binding.split('+');
  if (parts.some((part) => part.length === 0)) return false;
  const key = parts.at(-1);
  if (key === undefined || ['Ctrl', 'Alt', 'Shift', 'Meta'].includes(key)) {
    return false;
  }
  const modifiers = parts.slice(0, -1);
  return (
    new Set(modifiers).size === modifiers.length &&
    modifiers.every((part) => ['Ctrl', 'Alt', 'Shift', 'Meta'].includes(part))
  );
}
