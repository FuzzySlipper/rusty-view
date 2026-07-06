import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import {
  TopMenuBarComponent,
  type TopMenuEntry,
} from '@rusty-view/chat-components';

import { AdminProfilesPanelComponent } from './admin-profiles-panel';
import { AdminProvidersPanelComponent } from './admin-providers-panel';
import { AdminServicePanelComponent } from './admin-service-panel';
import { DebugPanelComponent } from './debug-panel';
import { HelpPanelComponent } from './help-panel';
import { OptionsPanelComponent } from './options-panel';
import { SessionsPanelComponent } from './sessions-panel';
import { TopMenuController } from './top-menu-controller';
import {
  CHAT_TOP_MENU_ITEMS,
  CHAT_TOP_MENU_PANELS,
  DEBUG_PANEL_ID,
  HELP_PANEL_ID,
  OPTIONS_PANEL_ID,
  PROFILES_PANEL_ID,
  PROVIDERS_PANEL_ID,
  SERVICE_PANEL_ID,
  SESSIONS_PANEL_ID,
  type ChatTopMenuItem,
  type ChatTopMenuPanel,
} from './shell-extension-tokens';

/** Built-in menu items the shell always ships with. */
const BUILT_IN_ITEMS: readonly ChatTopMenuItem[] = [
  {
    id: SESSIONS_PANEL_ID,
    label: 'Sessions',
    tooltip: 'Open recent sessions',
    kind: 'panel',
    panelId: SESSIONS_PANEL_ID,
    order: 10,
  },
  {
    id: PROFILES_PANEL_ID,
    label: 'Profiles',
    tooltip: 'Manage profiles and local tool profiles',
    kind: 'panel',
    panelId: PROFILES_PANEL_ID,
    order: 20,
  },
  {
    id: PROVIDERS_PANEL_ID,
    label: 'Providers',
    tooltip: 'Configure model providers',
    kind: 'panel',
    panelId: PROVIDERS_PANEL_ID,
    order: 25,
  },
  {
    id: SERVICE_PANEL_ID,
    label: 'Service',
    tooltip: 'Open service controls and diagnostics',
    kind: 'panel',
    panelId: SERVICE_PANEL_ID,
    order: 30,
  },
  {
    id: DEBUG_PANEL_ID,
    label: 'Debug',
    tooltip: 'Inspect runtime diagnostics',
    kind: 'panel',
    panelId: DEBUG_PANEL_ID,
    order: 40,
  },
  {
    id: OPTIONS_PANEL_ID,
    label: 'Options',
    tooltip: 'Open appearance and shell settings',
    kind: 'panel',
    panelId: OPTIONS_PANEL_ID,
    order: 90,
  },
  {
    id: HELP_PANEL_ID,
    label: 'Help',
    tooltip: 'Open command help',
    kind: 'panel',
    panelId: HELP_PANEL_ID,
    order: 100,
  },
];

const BUILT_IN_PANEL_IDS = new Set<string>([
  SESSIONS_PANEL_ID,
  PROFILES_PANEL_ID,
  PROVIDERS_PANEL_ID,
  SERVICE_PANEL_ID,
  DEBUG_PANEL_ID,
  OPTIONS_PANEL_ID,
  HELP_PANEL_ID,
]);

/**
 * Top menu: the modular menu bar plus the panels it can open.
 *
 * Container component — reads the {@link CHAT_TOP_MENU_ITEMS} and
 * {@link CHAT_TOP_MENU_PANELS} provider arrays, merges them with the built-in
 * panel entries (built-ins win on reserved id clashes), and renders a
 * {@link TopMenuBarComponent}. Selecting a `panel` item opens that panel as an
 * overlay; selecting an `action` item invokes its `onActivate` callback.
 * Downstream consumers add menu entries and panels by provider — they never
 * fork the bar.
 */
@Component({
  selector: 'rv-top-menu',
  imports: [
    NgComponentOutlet,
    TopMenuBarComponent,
    OptionsPanelComponent,
    HelpPanelComponent,
    SessionsPanelComponent,
    AdminProfilesPanelComponent,
    AdminProvidersPanelComponent,
    AdminServicePanelComponent,
    DebugPanelComponent,
  ],
  templateUrl: './top-menu.html',
  styleUrl: './top-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopMenuComponent {
  private readonly providedItems = inject(CHAT_TOP_MENU_ITEMS, {
    optional: true,
  });
  private readonly providedPanels = inject(CHAT_TOP_MENU_PANELS, {
    optional: true,
  });
  private readonly controller = inject(TopMenuController);

  protected readonly items = computed<readonly ChatTopMenuItem[]>(() => {
    const merged = new Map<string, ChatTopMenuItem>();
    for (const panel of this.customPanels()) {
      merged.set(panel.id, panelMenuItem(panel));
    }
    for (const item of flattenTopMenuProviders<ChatTopMenuItem>(
      this.providedItems,
    )) {
      merged.set(item.id, item);
    }
    for (const item of BUILT_IN_ITEMS) {
      merged.set(item.id, item);
    }
    return [...merged.values()].sort(
      (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id),
    );
  });

  protected readonly entries = computed<readonly TopMenuEntry[]>(() =>
    this.items().map((i) => menuEntry(i)),
  );

  protected readonly openPanelId = this.controller.openPanelId;

  protected readonly customPanels = computed<readonly ChatTopMenuPanel[]>(() =>
    flattenTopMenuProviders<ChatTopMenuPanel>(this.providedPanels)
      .filter((panel) => !BUILT_IN_PANEL_IDS.has(panel.id))
      .sort(
        (a, b) =>
          (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id),
      ),
  );

  protected readonly activeCustomPanel = computed<ChatTopMenuPanel | null>(
    () => {
      const openPanelId = this.openPanelId();
      if (openPanelId === null) return null;
      return (
        this.customPanels().find((panel) => panel.id === openPanelId) ?? null
      );
    },
  );

  protected readonly optionsOpen = computed(
    () => this.openPanelId() === OPTIONS_PANEL_ID,
  );
  protected readonly helpOpen = computed(
    () => this.openPanelId() === HELP_PANEL_ID,
  );
  protected readonly sessionsOpen = computed(
    () => this.openPanelId() === SESSIONS_PANEL_ID,
  );
  protected readonly profilesOpen = computed(
    () => this.openPanelId() === PROFILES_PANEL_ID,
  );
  protected readonly providersOpen = computed(
    () => this.openPanelId() === PROVIDERS_PANEL_ID,
  );
  protected readonly serviceOpen = computed(
    () => this.openPanelId() === SERVICE_PANEL_ID,
  );
  protected readonly debugOpen = computed(
    () => this.openPanelId() === DEBUG_PANEL_ID,
  );

  protected onSelect(id: string): void {
    const item = this.items().find((i) => i.id === id);
    if (item === undefined) return;

    if (item.kind === 'action') {
      item.onActivate?.();
      return;
    }

    // Panel kind: toggle the panel.
    const panelId = item.panelId ?? item.id;
    this.controller.togglePanel(panelId);
  }

  protected closePanel(): void {
    this.controller.closePanel();
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (this.openPanelId() === null) return;
    event.preventDefault();
    this.closePanel();
  }
}

function panelMenuItem(panel: ChatTopMenuPanel): ChatTopMenuItem {
  const item: ChatTopMenuItem = {
    id: panel.id,
    label: panel.label ?? panel.title,
    tooltip: `Open ${panel.title}`,
    kind: 'panel',
    panelId: panel.id,
  };
  return panel.order === undefined ? item : { ...item, order: panel.order };
}

function menuEntry(item: ChatTopMenuItem): TopMenuEntry {
  const entry: TopMenuEntry = {
    id: item.id,
    label: item.label,
  };
  return item.tooltip === undefined
    ? entry
    : { ...entry, tooltip: item.tooltip };
}

function flattenTopMenuProviders<T>(
  provided: readonly T[] | null,
): readonly T[] {
  const flattened: T[] = [];
  for (const entry of (provided ?? []) as readonly unknown[]) {
    if (Array.isArray(entry)) {
      flattened.push(...(entry as readonly T[]));
    } else {
      flattened.push(entry as T);
    }
  }
  return flattened;
}
