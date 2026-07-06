import { TestBed } from '@angular/core/testing';

import {
  CHAT_SETTINGS_STORAGE,
  CHAT_THEME,
  ChatTheme,
  DEFAULT_APPEARANCE,
  InMemoryChatSettingsStorage,
  type AppearanceSettings,
} from '../index';

describe('ChatTheme', () => {
  let storage: InMemoryChatSettingsStorage;

  function configure(defaults?: Partial<AppearanceSettings>): void {
    storage = new InMemoryChatSettingsStorage();
    TestBed.configureTestingModule({
      providers: [
        ChatTheme,
        { provide: CHAT_SETTINGS_STORAGE, useValue: storage },
        ...(defaults === undefined
          ? []
          : [{ provide: CHAT_THEME, useValue: defaults }]),
      ],
    });
    // Clean any token overrides left by previous tests on the real document.
    document.documentElement.style.cssText = '';
    document.documentElement.removeAttribute('data-rv-theme');
    document.documentElement.removeAttribute('data-rv-background-preset');
  }

  beforeEach(() => {
    configure();
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

  it('honors provideChatTheme defaults before persisted settings load', () => {
    TestBed.resetTestingModule();
    configure({
      themeId: 'dark',
      fontScale: 1.25,
      colors: { accent: '#00aaff' },
    });

    const theme = TestBed.inject(ChatTheme);
    TestBed.flushEffects?.();

    const root = document.documentElement;
    expect(theme.settings().themeId).toBe('dark');
    expect(root.getAttribute('data-rv-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--rv-font-size-md')).toBe('16px');
    expect(root.style.getPropertyValue('--rv-color-accent')).toBe('#00aaff');
  });

  it('lets persisted settings win over provideChatTheme defaults', async () => {
    TestBed.resetTestingModule();
    storage = new InMemoryChatSettingsStorage();
    await storage.save({ ...DEFAULT_APPEARANCE, themeId: 'light' });
    TestBed.configureTestingModule({
      providers: [
        ChatTheme,
        { provide: CHAT_SETTINGS_STORAGE, useValue: storage },
        { provide: CHAT_THEME, useValue: { themeId: 'dark' } },
      ],
    });
    document.documentElement.style.cssText = '';
    document.documentElement.removeAttribute('data-rv-theme');

    const theme = TestBed.inject(ChatTheme);
    await TestBed.inject(CHAT_SETTINGS_STORAGE).load();
    await fixtureStabilize();
    TestBed.flushEffects?.();

    expect(theme.settings().themeId).toBe('light');
    expect(document.documentElement.getAttribute('data-rv-theme')).toBe(
      'light',
    );
  });

  it('reset restores host-provided defaults and persists that baseline', async () => {
    TestBed.resetTestingModule();
    configure({ themeId: 'dark', messageSpacing: 'roomy' });
    const theme = TestBed.inject(ChatTheme);

    await theme.update({ themeId: 'light', messageSpacing: 'compact' });
    await theme.reset();
    TestBed.flushEffects?.();

    expect(theme.settings().themeId).toBe('dark');
    expect(theme.settings().messageSpacing).toBe('roomy');
    expect(document.documentElement.getAttribute('data-rv-theme')).toBe('dark');
    expect(
      document.documentElement.style.getPropertyValue('--rv-message-padding-y'),
    ).toBe('8px');
    expect(await storage.load()).toMatchObject({
      themeId: 'dark',
      messageSpacing: 'roomy',
    });
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

  it('applies selected font families to prose and UI chrome', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ fontFamily: 'serif' });
    TestBed.flushEffects?.();

    expect(
      document.documentElement.style.getPropertyValue('--rv-font-sans'),
    ).toContain('Georgia');
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-ui'),
    ).toContain('Georgia');
    expect(theme.settings().fontFamily).toBe('serif');

    await theme.update({ fontFamily: 'readable' });
    TestBed.flushEffects?.();
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-ui'),
    ).toContain('Atkinson Hyperlegible');
    expect(theme.settings().fontFamily).toBe('readable');
  });

  it('flattens prose and UI chrome to mono when fontFamily is mono', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ fontFamily: 'mono' });
    TestBed.flushEffects?.();
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-sans'),
    ).toContain('--rv-font-mono');
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-ui'),
    ).toContain('--rv-font-mono');

    await theme.update({ fontFamily: 'system' });
    TestBed.flushEffects?.();
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-sans'),
    ).toContain('system-ui');
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-ui'),
    ).toContain('system-ui');
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

  it('applies chat layout and transcript metadata preferences', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({
      chatWidthPercent: 55,
      messageSpacing: 'roomy',
      showTimestamps: true,
      showMessageIds: true,
    });
    TestBed.flushEffects?.();

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--rv-chat-width')).toBe('55%');
    expect(root.style.getPropertyValue('--rv-message-padding-y')).toBe('8px');
    expect(root.getAttribute('data-rv-show-timestamps')).toBe('true');
    expect(root.getAttribute('data-rv-show-message-ids')).toBe('true');

    const stored = await storage.load();
    expect(stored?.chatWidthPercent).toBe(55);
    expect(stored?.messageSpacing).toBe('roomy');
  });

  it('applies reduced motion and shadow preferences', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ reducedMotion: true, disableShadows: true });
    TestBed.flushEffects?.();

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--rv-motion-fast')).toBe('0ms');
    expect(root.style.getPropertyValue('--rv-motion-base')).toBe('0ms');
    expect(root.style.getPropertyValue('--rv-shadow-sm')).toBe('none');
    expect(root.style.getPropertyValue('--rv-shadow-overlay')).toBe('none');
    expect(root.getAttribute('data-rv-reduced-motion')).toBe('true');
    expect(root.getAttribute('data-rv-disable-shadows')).toBe('true');

    await theme.reset();
    TestBed.flushEffects?.();
    expect(root.style.getPropertyValue('--rv-motion-fast')).toBe('');
    expect(root.style.getPropertyValue('--rv-shadow-sm')).toBe('');
    expect(root.hasAttribute('data-rv-reduced-motion')).toBe(false);
    expect(root.hasAttribute('data-rv-disable-shadows')).toBe(false);
  });

  it('applies and persists background presets', async () => {
    const theme = TestBed.inject(ChatTheme);
    await theme.update({ backgroundPreset: 'grid' });
    TestBed.flushEffects?.();

    const root = document.documentElement;
    expect(root.getAttribute('data-rv-background-preset')).toBe('grid');
    expect(theme.settings().backgroundPreset).toBe('grid');
    expect((await storage.load())?.backgroundPreset).toBe('grid');

    await theme.update({ backgroundPreset: 'none' });
    TestBed.flushEffects?.();
    expect(root.hasAttribute('data-rv-background-preset')).toBe(false);
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

async function fixtureStabilize(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
