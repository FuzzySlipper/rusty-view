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
    document.documentElement.removeAttribute('data-rv-theme');
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

  it('default textRenderMode is auto', () => {
    const theme = TestBed.inject(ChatTheme);
    expect(theme.settings().textRenderMode).toBe('auto');
  });

  it('toggles textRenderMode and persists', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ textRenderMode: 'raw' });
    expect(theme.settings().textRenderMode).toBe('raw');

    const stored = await storage.load();
    expect(stored?.textRenderMode).toBe('raw');

    // Toggle to sanitized-html.
    await theme.update({ textRenderMode: 'sanitized-html' });
    expect(theme.settings().textRenderMode).toBe('sanitized-html');

    await theme.update({ textRenderMode: 'auto' });
    expect(theme.settings().textRenderMode).toBe('auto');
  });

  it('reset restores textRenderMode to default auto', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ textRenderMode: 'raw' });
    await theme.reset();
    expect(theme.settings().textRenderMode).toBe('auto');
  });

  it('selects a named base theme via the data-rv-theme attribute (#3691)', async () => {
    const theme = TestBed.inject(ChatTheme);
    TestBed.flushEffects?.();
    // auto sets no attribute.
    expect(document.documentElement.hasAttribute('data-rv-theme')).toBe(false);

    await theme.setTheme('high-contrast');
    TestBed.flushEffects?.();
    expect(document.documentElement.getAttribute('data-rv-theme')).toBe(
      'high-contrast',
    );

    await theme.setTheme('auto');
    TestBed.flushEffects?.();
    expect(document.documentElement.hasAttribute('data-rv-theme')).toBe(false);
  });

  it('applies the full semantic colour set, not a subset (#3691)', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({
      colors: {
        warning: '#abcabc',
        surfaceAlt: '#123123',
        scrim: 'rgba(1, 2, 3, 0.4)',
      },
    });
    TestBed.flushEffects?.();
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--rv-color-warning')).toBe('#abcabc');
    expect(style.getPropertyValue('--rv-color-surface-alt')).toBe('#123123');
    expect(style.getPropertyValue('--rv-color-scrim')).toBe(
      'rgba(1, 2, 3, 0.4)',
    );
  });

  it('round-trips settings through export/import (#3691)', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({
      themeId: 'light',
      fontScale: 1.2,
      colors: { accent: '#0099ff' },
    });
    const json = theme.exportTheme();

    await theme.reset();
    expect(theme.settings().themeId).toBe('auto');

    const ok = await theme.importTheme(json);
    expect(ok).toBe(true);
    expect(theme.settings().themeId).toBe('light');
    expect(theme.settings().fontScale).toBe(1.2);
    expect(theme.settings().colors.accent).toBe('#0099ff');
  });

  it('rejects invalid import JSON and junk colour values (#3691)', async () => {
    const theme = TestBed.inject(ChatTheme);
    expect(await theme.importTheme('not json')).toBe(false);
    expect(await theme.importTheme('42')).toBe(false);

    // Junk colour keys/values are dropped on import.
    const ok = await theme.importTheme(
      JSON.stringify({ colors: { accent: '#fff', bogus: 5, danger: '' } }),
    );
    expect(ok).toBe(true);
    expect(theme.settings().colors.accent).toBe('#fff');
    expect('bogus' in theme.settings().colors).toBe(false);
    expect('danger' in theme.settings().colors).toBe(false);
  });
});
