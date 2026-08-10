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
});
