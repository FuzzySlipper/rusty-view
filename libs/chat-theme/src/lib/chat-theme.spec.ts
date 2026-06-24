import { TestBed } from '@angular/core/testing';

import {
  CHAT_SETTINGS_STORAGE,
  ChatTheme,
  DEFAULT_APPEARANCE,
  InMemoryChatSettingsStorage,
} from '../index';

describe('ChatTheme', () => {
  let storage: InMemoryChatSettingsStorage;

  beforeEach(() => {
    storage = new InMemoryChatSettingsStorage();
    TestBed.configureTestingModule({
      providers: [
        ChatTheme,
        { provide: CHAT_SETTINGS_STORAGE, useValue: storage },
      ],
    });
    // Clean any token overrides left by previous tests on the real document.
    document.documentElement.style.cssText = '';
  });

  it('applies default font sizes to the document root', () => {
    const theme = TestBed.inject(ChatTheme);
    TestBed.flushEffects?.();
    const style = document.documentElement.style;
    // Default scale = 1 → md = 13px; no colour overrides on defaults.
    expect(style.getPropertyValue('--rv-font-size-md')).toBe('13px');
    expect(style.getPropertyValue('--rv-color-bg')).toBe('');
    expect(theme.settings()).toEqual(DEFAULT_APPEARANCE);
  });

  it('scales font sizes and persists the change', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ fontScale: 1.5 });
    TestBed.flushEffects?.();

    expect(
      document.documentElement.style.getPropertyValue('--rv-font-size-md'),
    ).toBe('20px');
    expect(theme.settings().fontScale).toBe(1.5);

    const stored = await storage.load();
    expect(stored?.fontScale).toBe(1.5);
  });

  it('clamps out-of-range font scale', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ fontScale: 99 });
    expect(theme.settings().fontScale).toBe(1.5);
  });

  it('applies and removes colour overrides on reset', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ colors: { bg: '#101010', accent: '#ff0000' } });
    TestBed.flushEffects?.();
    expect(
      document.documentElement.style.getPropertyValue('--rv-color-bg'),
    ).toBe('#101010');
    expect(
      document.documentElement.style.getPropertyValue('--rv-color-accent'),
    ).toBe('#ff0000');

    await theme.reset();
    TestBed.flushEffects?.();
    expect(
      document.documentElement.style.getPropertyValue('--rv-color-bg'),
    ).toBe('');
    expect(
      document.documentElement.style.getPropertyValue('--rv-color-accent'),
    ).toBe('');
  });

  it('flattens prose to mono when fontFamily is mono', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ fontFamily: 'mono' });
    TestBed.flushEffects?.();
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-sans'),
    ).toContain('--rv-font-mono');

    await theme.update({ fontFamily: 'system' });
    TestBed.flushEffects?.();
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-sans'),
    ).toBe('');
  });

  it('deep-merges colours on update', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ colors: { bg: '#aaaaaa' } });
    await theme.update({ colors: { accent: '#bbbbbb' } });
    expect(theme.settings().colors.bg).toBe('#aaaaaa');
    expect(theme.settings().colors.accent).toBe('#bbbbbb');
  });
});
