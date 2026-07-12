import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOTKEY_SETTINGS,
  HOTKEY_SETTINGS_STORAGE,
  HotkeySettingsService,
  normalizeHotkeySettings,
  type HotkeySettings,
  type HotkeySettingsStorage,
} from './hotkey-settings';
import { canCycleExternalThread, cyclicTarget } from './debug-shell';

class MemoryHotkeyStorage implements HotkeySettingsStorage {
  value: unknown | null = null;
  async load(): Promise<unknown | null> {
    return this.value;
  }
  async save(settings: HotkeySettings): Promise<void> {
    this.value = settings;
  }
}

describe('HotkeySettingsService', () => {
  it('persists unique bindings and rejects conflicts', async () => {
    const storage = new MemoryHotkeyStorage();
    TestBed.configureTestingModule({
      providers: [
        HotkeySettingsService,
        { provide: HOTKEY_SETTINGS_STORAGE, useValue: storage },
      ],
    });
    const service = TestBed.inject(HotkeySettingsService);

    expect(await service.setBinding('nextSession', 'Alt+N')).toBe(true);
    expect(await service.setBinding('previousSession', 'Alt+N')).toBe(false);
    expect(service.binding('nextSession')).toBe('Alt+N');
    expect(storage.value).toMatchObject({
      version: 1,
      bindings: { nextSession: 'Alt+N' },
    });
  });

  it('falls back safely for stale, invalid, or conflicting stored settings', () => {
    expect(normalizeHotkeySettings({ version: 0 })).toBe(
      DEFAULT_HOTKEY_SETTINGS,
    );
    expect(
      normalizeHotkeySettings({
        version: 1,
        bindings: {
          nextSession: 'Ctrl+W',
          previousSession: 'Ctrl+W',
          erasePreviousWord: 'Ctrl+W',
        },
      }),
    ).toBe(DEFAULT_HOTKEY_SETTINGS);
  });
});

describe('cyclicTarget', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('wraps in both directions and starts at the directional edge', () => {
    expect(cyclicTarget(items, 'c', (item) => item.id, 1)?.id).toBe('a');
    expect(cyclicTarget(items, 'a', (item) => item.id, -1)?.id).toBe('c');
    expect(cyclicTarget(items, undefined, (item) => item.id, 1)?.id).toBe('a');
    expect(cyclicTarget(items, undefined, (item) => item.id, -1)?.id).toBe('c');
  });

  it('excludes archived external threads from cycling candidates', () => {
    expect(canCycleExternalThread('idle')).toBe(true);
    expect(canCycleExternalThread('active')).toBe(true);
    expect(canCycleExternalThread('archived')).toBe(false);
  });
});
