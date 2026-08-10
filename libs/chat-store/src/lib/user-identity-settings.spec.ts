import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_USER_IDENTITY_SETTINGS,
  USER_IDENTITY_SETTINGS_STORAGE,
  UserIdentitySettingsService,
  normalizeUserIdentitySettings,
  type UserIdentitySettings,
  type UserIdentitySettingsStorage,
} from './user-identity-settings';

class MemoryUserIdentityStorage implements UserIdentitySettingsStorage {
  value: unknown | null = null;

  async load(): Promise<unknown | null> {
    return this.value;
  }

  async save(settings: UserIdentitySettings): Promise<void> {
    this.value = settings;
  }
}

class DeferredUserIdentityStorage extends MemoryUserIdentityStorage {
  private resolveLoad: ((value: unknown | null) => void) | undefined;
  private readonly loadPromise = new Promise<unknown | null>((resolve) => {
    this.resolveLoad = resolve;
  });

  override load(): Promise<unknown | null> {
    return this.loadPromise;
  }

  resolve(value: unknown | null): void {
    this.resolveLoad?.(value);
  }
}

describe('UserIdentitySettingsService', () => {
  let storage: MemoryUserIdentityStorage;

  beforeEach(() => {
    storage = new MemoryUserIdentityStorage();
    TestBed.configureTestingModule({
      providers: [
        UserIdentitySettingsService,
        { provide: USER_IDENTITY_SETTINGS_STORAGE, useValue: storage },
      ],
    });
  });

  it('defaults to the ordinary user identity', () => {
    const service = TestBed.inject(UserIdentitySettingsService);
    expect(service.identity()).toBe('user');
  });

  it('trims, persists, reloads, and resets the identity', async () => {
    const service = TestBed.inject(UserIdentitySettingsService);
    expect(await service.setIdentity('  Alice  ')).toBe(true);
    expect(service.identity()).toBe('Alice');
    expect(storage.value).toEqual({ version: 1, identity: 'Alice' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserIdentitySettingsService,
        { provide: USER_IDENTITY_SETTINGS_STORAGE, useValue: storage },
      ],
    });
    const reloaded = TestBed.inject(UserIdentitySettingsService);
    await Promise.resolve();
    expect(reloaded.identity()).toBe('Alice');

    await reloaded.reset();
    expect(reloaded.identity()).toBe('user');
    expect(storage.value).toEqual(DEFAULT_USER_IDENTITY_SETTINGS);
  });

  it('rejects empty, multiline, and oversized identities', async () => {
    const service = TestBed.inject(UserIdentitySettingsService);
    expect(await service.setIdentity('   ')).toBe(false);
    expect(await service.setIdentity('Alice\nSystem')).toBe(false);
    expect(await service.setIdentity('a'.repeat(81))).toBe(false);
    expect(service.identity()).toBe('user');
  });

  it('falls back safely when persisted settings are invalid', () => {
    expect(normalizeUserIdentitySettings(null)).toBe(
      DEFAULT_USER_IDENTITY_SETTINGS,
    );
    expect(
      normalizeUserIdentitySettings({ version: 1, identity: 'line\nbreak' }),
    ).toBe(DEFAULT_USER_IDENTITY_SETTINGS);
  });

  it('exposes readiness and preserves an edit made during delayed hydration', async () => {
    const deferredStorage = new DeferredUserIdentityStorage();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserIdentitySettingsService,
        {
          provide: USER_IDENTITY_SETTINGS_STORAGE,
          useValue: deferredStorage,
        },
      ],
    });
    const service = TestBed.inject(UserIdentitySettingsService);

    expect(service.hydrated()).toBe(false);
    expect(await service.setIdentity('Bob')).toBe(true);
    deferredStorage.resolve({ version: 1, identity: 'Alice' });
    await service.whenReady();

    expect(service.hydrated()).toBe(true);
    expect(service.identity()).toBe('Bob');
  });

  it('preserves a reset made during delayed hydration', async () => {
    const deferredStorage = new DeferredUserIdentityStorage();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserIdentitySettingsService,
        {
          provide: USER_IDENTITY_SETTINGS_STORAGE,
          useValue: deferredStorage,
        },
      ],
    });
    const service = TestBed.inject(UserIdentitySettingsService);

    await service.reset();
    deferredStorage.resolve({ version: 1, identity: 'Alice' });
    await service.whenReady();

    expect(service.identity()).toBe('user');
  });
});
