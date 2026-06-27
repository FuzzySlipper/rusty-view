import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import {
  CHAT_SETTINGS_STORAGE,
  ChatTheme,
  InMemoryChatSettingsStorage,
} from '@rusty-view/chat-theme';

import { TopMenuComponent } from './top-menu';

/** Query all menu item buttons and return their trimmed labels. */
function menuItemLabels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.rv-top-menu__item')).map((b) => {
    const el = b as HTMLElement;
    return el.textContent?.trim() ?? '';
  });
}

/** Find the first menu button with a given label. */
function findMenuButton(
  host: HTMLElement,
  label: string,
): HTMLElement | undefined {
  return Array.from(host.querySelectorAll('.rv-top-menu__item'))
    .map((b) => b as HTMLElement)
    .find((el) => (el.textContent?.trim() ?? '') === label);
}

describe('TopMenuComponent', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  async function createMenu() {
    await TestBed.configureTestingModule({
      imports: [TopMenuComponent],
      providers: [
        ChatTheme,
        {
          provide: CHAT_SETTINGS_STORAGE,
          useValue: new InMemoryChatSettingsStorage(),
        },
        {
          provide: ChatStore,
          useValue: { commands: () => [] } as unknown as ChatStore,
        },
        {
          provide: AdminStore,
          useValue: {
            refresh: async () => undefined,
            loading: () => false,
            saving: () => false,
            error: () => null,
            profiles: () => [],
            registryRecords: () => [],
            profileDiagnostics: () => null,
            exportPlan: () => null,
            clearExportPlan: () => undefined,
            loadExportPlan: async () => undefined,
            overview: () => null,
            configValidation: () => null,
            createResult: () => null,
            reloadResult: () => null,
            controlCapabilityState: () => 'unknown',
          } as unknown as AdminStore,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TopMenuComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the built-in Options and Help menu entries', async () => {
    const fixture = await createMenu();
    const labels = menuItemLabels(fixture.nativeElement as HTMLElement);
    expect(labels).toContain('Profiles');
    expect(labels).toContain('Service');
    expect(labels).toContain('Options');
    expect(labels).toContain('Help');
  });

  it('opens the Profiles panel when Profiles is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Profiles')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-admin-profiles-panel')).not.toBeNull();
  });

  it('opens the Service panel when Service is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Service')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-admin-service-panel')).not.toBeNull();
  });

  it('opens the Options panel when Options is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('rv-options-panel')).toBeNull();

    findMenuButton(host, 'Options')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-options-panel')).not.toBeNull();
  });

  it('opens the Help panel when Help is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Help')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-help-panel')).not.toBeNull();
  });

  it('toggles the panel closed when the same entry is clicked again', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Help')?.click();
    fixture.detectChanges();
    expect(host.querySelector('rv-help-panel')).not.toBeNull();

    findMenuButton(host, 'Help')?.click();
    fixture.detectChanges();
    expect(host.querySelector('rv-help-panel')).toBeNull();
  });
});
