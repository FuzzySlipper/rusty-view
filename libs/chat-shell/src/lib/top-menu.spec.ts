import { Component, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import {
  CHAT_SETTINGS_STORAGE,
  ChatTheme,
  InMemoryChatSettingsStorage,
} from '@rusty-view/chat-theme';

import { TopMenuComponent } from './top-menu';
import { TopMenuController } from './top-menu-controller';
import {
  CHAT_TOP_MENU_CONFIGURATION,
  CHAT_TOP_MENU_PANELS,
  OPTIONS_PANEL_ID,
  SERVICE_PANEL_ID,
  SESSIONS_PANEL_ID,
} from './shell-extension-tokens';

@Component({
  selector: 'rv-test-roleplay-panel',
  template: '<div data-testid="roleplay-panel">Roleplay panel body</div>',
})
class TestRoleplayPanelComponent {}

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
    TestBed.resetTestingModule();
  });

  async function createMenu(extraProviders: Provider[] = []) {
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
          useValue: {
            commands: () => [],
            allSessions: () => [],
            activeSessionId: () => null,
            rawEvents: () => [],
            projection: () => ({ toolCalls: [] }),
            loadProviderRequestDebugDetail: async () => undefined,
            loadToolCallDebugDetail: async () => undefined,
            viewHistoricalSession: async () => undefined,
            refreshSessions: async () => undefined,
          } as unknown as ChatStore,
        },
        {
          provide: AdminStore,
          useValue: {
            refresh: async () => undefined,
            loading: () => false,
            saving: () => false,
            error: () => null,
            runtimePauseResult: () => null,
            runtimeResumeResult: () => null,
            pauseForSession: () => undefined,
            pauseRuntime: async () => undefined,
            resumeRuntime: async () => undefined,
            profiles: () => [],
            registryRecords: () => [],
            profileDiagnostics: () => null,
            mcpServers: () => [],
            mcpToolProfiles: () => [],
            mcpBindings: () => [],
            toolsetCatalog: () => [],
            toolCatalogTools: () => [],
            exportPlan: () => null,
            clearExportPlan: () => undefined,
            loadExportPlan: async () => undefined,
            providerAliases: () => [],
            modelProviders: () => null,
            providerLoadError: () => null,
            providerWriteResult: () => null,
            loadStorageQueryCatalog: async () => undefined,
            executeStorageQuery: async () => true,
            storageQueryCatalog: () => null,
            storageQueryResult: () => null,
            storageQueryLoading: () => false,
            storageQueryError: () => null,
            createModelProvider: async () => undefined,
            updateModelProvider: async () => undefined,
            clearProviderWriteResult: () => undefined,
            loadOpenAiOauthStatus: async () => undefined,
            openAiOauthStatus: () => null,
            openAiOauthStartResult: () => null,
            completeOpenAiOauthLogin: async () => undefined,
            clearOpenAiOauthCredential: async () => undefined,
            overview: () => null,
            configValidation: () => null,
            createResult: () => null,
            reloadResult: () => null,
            runtimeConfigDraftResult: () => null,
            wakeTimeoutPatchResult: () => null,
            controlCapabilityState: () => 'unknown',
          } as unknown as AdminStore,
        },
        ...extraProviders,
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
    expect(labels).toContain('Debug');
    expect(labels).toContain('Options');
    expect(labels).toContain('Help');
  });

  it('suppresses selected built-in entries without changing the defaults', async () => {
    const fixture = await createMenu([
      {
        provide: CHAT_TOP_MENU_CONFIGURATION,
        useValue: {
          hiddenBuiltInItemIds: [SESSIONS_PANEL_ID, SERVICE_PANEL_ID],
        },
      },
    ]);
    const labels = menuItemLabels(fixture.nativeElement as HTMLElement);

    expect(labels).not.toContain('Sessions');
    expect(labels).not.toContain('Service');
    expect(labels).toContain('Debug');
    expect(labels).toContain('Options');
  });

  it('opens the Profiles panel when Profiles is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Profiles')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-admin-profiles-panel')).not.toBeNull();
  });

  it('opens and closes a built-in panel through the public controller', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;
    const controller = TestBed.inject(TopMenuController);

    controller.openPanel('sessions');
    fixture.detectChanges();
    expect(host.querySelector('rv-sessions-panel')).not.toBeNull();

    controller.closePanel();
    fixture.detectChanges();
    expect(host.querySelector('rv-sessions-panel')).toBeNull();
  });

  it('opens a custom registered panel through the public controller', async () => {
    const fixture = await createMenu([
      {
        provide: CHAT_TOP_MENU_PANELS,
        multi: true,
        useValue: [
          {
            id: 'rp-sessions',
            title: 'Roleplay Sessions',
            component: TestRoleplayPanelComponent,
          },
        ],
      },
    ]);
    const host = fixture.nativeElement as HTMLElement;
    const controller = TestBed.inject(TopMenuController);

    controller.openPanel('rp-sessions');
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="roleplay-panel"]')).not.toBeNull();
  });

  it('opens the Sessions panel when Sessions is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Sessions')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-sessions-panel')).not.toBeNull();
  });

  it('opens the Service panel when Service is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Service')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-admin-service-panel')).not.toBeNull();
  });

  it('opens the Providers panel when Providers is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Providers')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-admin-providers-panel')).not.toBeNull();
  });

  it('opens the Debug panel when Debug is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Debug')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-debug-panel')).not.toBeNull();
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

  it('switches directly from Options to Providers when another top-menu item is clicked', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Options')?.click();
    fixture.detectChanges();
    expect(host.querySelector('rv-options-panel')).not.toBeNull();

    findMenuButton(host, 'Providers')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-options-panel')).toBeNull();
    expect(host.querySelector('rv-admin-providers-panel')).not.toBeNull();
  });

  it('closes the open top-menu panel on Escape', async () => {
    const fixture = await createMenu();
    const host = fixture.nativeElement as HTMLElement;

    findMenuButton(host, 'Options')?.click();
    fixture.detectChanges();
    expect(host.querySelector('rv-options-panel')).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();

    expect(host.querySelector('rv-options-panel')).toBeNull();
  });

  it('renders and dismisses a downstream custom top-menu panel', async () => {
    const fixture = await createMenu([
      {
        provide: CHAT_TOP_MENU_PANELS,
        useValue: [
          {
            id: 'roleplay-lore',
            label: 'Lore',
            title: 'Lore',
            order: 35,
            width: 'wide',
            component: TestRoleplayPanelComponent,
          },
        ],
      },
    ]);
    const host = fixture.nativeElement as HTMLElement;

    expect(menuItemLabels(host)).toContain('Lore');
    findMenuButton(host, 'Lore')?.click();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="roleplay-panel"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="top-menu-panel-custom"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('Roleplay panel body');

    (
      host.querySelector(
        '[data-testid="top-menu-panel-close"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="roleplay-panel"]')).toBeNull();

    findMenuButton(host, 'Lore')?.click();
    fixture.detectChanges();
    (
      host.querySelector(
        '[data-testid="top-menu-overlay-custom"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="roleplay-panel"]')).toBeNull();
  });

  it('keeps built-in reserved panel ids stable over custom panels', async () => {
    const fixture = await createMenu([
      {
        provide: CHAT_TOP_MENU_PANELS,
        useValue: [
          {
            id: OPTIONS_PANEL_ID,
            label: 'Roleplay Options',
            title: 'Roleplay Options',
            component: TestRoleplayPanelComponent,
          },
        ],
      },
    ]);
    const host = fixture.nativeElement as HTMLElement;

    expect(menuItemLabels(host)).toContain('Options');
    expect(menuItemLabels(host)).not.toContain('Roleplay Options');

    findMenuButton(host, 'Options')?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-options-panel')).not.toBeNull();
    expect(host.querySelector('[data-testid="roleplay-panel"]')).toBeNull();
  });

  it('does not make a reserved panel replaceable when its menu item is hidden', async () => {
    const fixture = await createMenu([
      {
        provide: CHAT_TOP_MENU_CONFIGURATION,
        useValue: { hiddenBuiltInItemIds: [OPTIONS_PANEL_ID] },
      },
      {
        provide: CHAT_TOP_MENU_PANELS,
        useValue: [
          {
            id: OPTIONS_PANEL_ID,
            label: 'Roleplay Options',
            title: 'Roleplay Options',
            component: TestRoleplayPanelComponent,
          },
        ],
      },
    ]);
    const host = fixture.nativeElement as HTMLElement;

    expect(menuItemLabels(host)).not.toContain('Options');
    expect(menuItemLabels(host)).not.toContain('Roleplay Options');

    TestBed.inject(TopMenuController).openPanel(OPTIONS_PANEL_ID);
    fixture.detectChanges();
    expect(host.querySelector('rv-options-panel')).not.toBeNull();
    expect(host.querySelector('[data-testid="roleplay-panel"]')).toBeNull();
  });
});
