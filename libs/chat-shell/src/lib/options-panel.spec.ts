import { type OutputEmitterRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  CHAT_SETTINGS_STORAGE,
  ChatTheme,
  InMemoryChatSettingsStorage,
} from '@rusty-view/chat-theme';

import { OptionsPanelComponent } from './options-panel';

describe('OptionsPanelComponent', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  async function createOptions() {
    await TestBed.configureTestingModule({
      imports: [OptionsPanelComponent],
      providers: [
        ChatTheme,
        {
          provide: CHAT_SETTINGS_STORAGE,
          useValue: new InMemoryChatSettingsStorage(),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsPanelComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the built-in Appearance tab', async () => {
    const fixture = await createOptions();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('User Settings');
    expect(host.textContent).toContain('Appearance');
    // The appearance tab component is rendered by default.
    expect(host.querySelector('rv-appearance-tab')).not.toBeNull();
  });

  it('renders dense reusable chat preferences and applies toggles', async () => {
    const fixture = await createOptions();
    const host: HTMLElement = fixture.nativeElement;
    const theme = TestBed.inject(ChatTheme);

    expect(host.textContent).toContain('UI Theme');
    expect(host.textContent).toContain('Theme Colors');
    expect(host.textContent).toContain('Chat / Message Handling');
    expect(host.textContent).toContain('Chat Width');
    expect(host.textContent).toContain('Composer Height');
    expect(host.textContent).toContain('Message IDs');
    expect(host.textContent).toContain('Message action buttons');
    expect(host.textContent).toContain('Auto-expand reasoning blocks');

    const messageIds = Array.from(host.querySelectorAll('label')).find(
      (label) => label.textContent?.includes('Message IDs') ?? false,
    );
    const checkbox = messageIds?.querySelector('input');
    checkbox?.click();
    fixture.detectChanges();

    expect(theme.settings().showMessageIds).toBe(true);

    const messageActions = host.querySelector<HTMLInputElement>(
      '[data-testid="appearance-message-actions"]',
    );
    messageActions?.click();
    fixture.detectChanges();
    expect(theme.settings().showMessageActions).toBe(false);

    const autoExpandReasoning = host.querySelector<HTMLInputElement>(
      '[data-testid="appearance-auto-expand-reasoning"]',
    );
    autoExpandReasoning?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(theme.settings().autoExpandReasoning).toBe(true);
  });

  it('configures interface and technical font roles independently', async () => {
    const fixture = await createOptions();
    const host: HTMLElement = fixture.nativeElement;
    const theme = TestBed.inject(ChatTheme);

    expect(host.textContent).toContain('Interface & prose font');
    expect(host.textContent).toContain('Technical font');
    expect(host.textContent).toContain(
      'Reasoning, code, IDs, diagnostics, and profile/agent metadata.',
    );

    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="appearance-interface-font-serif"]',
      )
      ?.click();
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="appearance-technical-font-arial"]',
      )
      ?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(theme.settings().fontFamily).toBe('serif');
    expect(theme.settings().technicalFontFamily).toBe('arial');
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-ui'),
    ).toContain('Georgia');
    expect(
      document.documentElement.style.getPropertyValue('--rv-font-technical'),
    ).toContain('Arial');
  });

  it('updates and resets the persisted composer height preference', async () => {
    const fixture = await createOptions();
    const host: HTMLElement = fixture.nativeElement;
    const theme = TestBed.inject(ChatTheme);
    const slider = host.querySelector<HTMLInputElement>(
      '[data-testid="appearance-composer-height"]',
    );

    expect(slider).not.toBeNull();
    if (slider === null) return;
    slider.value = '200';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(theme.settings().composerHeightPx).toBe(200);
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="appearance-composer-height-reset"]',
      )
      ?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(theme.settings().composerHeightPx).toBe(72);
  });

  it('toggles the persisted session status bar preference', async () => {
    const fixture = await createOptions();
    const theme = TestBed.inject(ChatTheme);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="appearance-session-status-bar"]',
    ) as HTMLInputElement;

    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(theme.settings().showSessionStatusBar).toBe(false);
  });

  it('keeps the appearance tab active by default', async () => {
    const fixture = await createOptions();
    const activeTab: HTMLElement | null = fixture.nativeElement.querySelector(
      '.rv-tab-strip__tab--active',
    );
    expect(activeTab?.textContent?.trim()).toBe('Appearance');
  });

  it('renders the built-in Hotkeys tab and records a unique shortcut', async () => {
    const fixture = await createOptions();
    const host: HTMLElement = fixture.nativeElement;
    const hotkeysTab = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.rv-tab-strip__tab'),
    ).find((button) => button.textContent?.trim() === 'Hotkeys');
    hotkeysTab?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-hotkeys-tab')).not.toBeNull();
    const nextRow = host.querySelector<HTMLElement>(
      '[data-hotkey-action="nextSession"]',
    );
    const record = nextRow?.querySelector<HTMLButtonElement>(
      '[data-testid="hotkey-record"]',
    );
    record?.click();
    record?.dispatchEvent(
      new KeyboardEvent('keydown', {
        altKey: true,
        key: 'n',
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(nextRow?.querySelector('kbd')?.textContent).toContain('Alt+N');
  });

  it('emits dismissed when the close button is clicked', async () => {
    const fixture = await createOptions();
    let dismissed = false;
    (
      fixture.componentInstance as OptionsPanelComponent & {
        dismissed: OutputEmitterRef<void>;
      }
    ).dismissed.subscribe(() => {
      dismissed = true;
    });

    const closeBtn: HTMLElement | null =
      fixture.nativeElement.querySelector('.rv-options__close');
    closeBtn?.click();
    expect(dismissed).toBe(true);
  });
});
