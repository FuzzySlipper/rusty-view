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
    expect(host.textContent).toContain('Message IDs');

    const messageIds = Array.from(host.querySelectorAll('label')).find(
      (label) => label.textContent?.includes('Message IDs') ?? false,
    );
    const checkbox = messageIds?.querySelector('input');
    checkbox?.click();
    fixture.detectChanges();

    expect(theme.settings().showMessageIds).toBe(true);
  });

  it('keeps the appearance tab active by default', async () => {
    const fixture = await createOptions();
    const activeTab: HTMLElement | null = fixture.nativeElement.querySelector(
      '.rv-tab-strip__tab--active',
    );
    expect(activeTab?.textContent?.trim()).toBe('Appearance');
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
