import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TopMenuBarComponent, type TopMenuEntry } from '@rusty-view/chat-components';

import { HelpPanelComponent } from './help-panel';
import { OptionsPanelComponent } from './options-panel';
import {
  CHAT_TOP_MENU_ITEMS,
  HELP_PANEL_ID,
  OPTIONS_PANEL_ID,
  type ChatTopMenuItem,
} from './shell-extension-tokens';

/** Built-in menu items the shell always ships with. */
const BUILT_IN_ITEMS: readonly ChatTopMenuItem[] = [
  { id: OPTIONS_PANEL_ID, label: 'Options', kind: 'panel', panelId: OPTIONS_PANEL_ID, order: 90 },
  { id: HELP_PANEL_ID, label: 'Help', kind: 'panel', panelId: HELP_PANEL_ID, order: 100 },
];

/**
 * Top menu: the modular menu bar plus the panels it can open.
 *
 * Container component — reads the {@link CHAT_TOP_MENU_ITEMS} multi-provider,
 * merges it with the built-in Options/Help entries (built-ins win on id
 * clashes), and renders a {@link TopMenuBarComponent}. Selecting a `panel`
 * item opens that panel as an overlay; selecting an `action` item invokes its
 * `onActivate` callback. Downstream consumers add menu entries by providing
 * more items — they never fork the bar.
 */
@Component({
  selector: 'rv-top-menu',
  imports: [TopMenuBarComponent, OptionsPanelComponent, HelpPanelComponent],
  templateUrl: './top-menu.html',
  styleUrl: './top-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopMenuComponent {
  private readonly providedItems = inject(CHAT_TOP_MENU_ITEMS, {
    optional: true,
  });

  protected readonly items = computed<readonly ChatTopMenuItem[]>(() => {
    const merged = new Map<string, ChatTopMenuItem>();
    for (const item of this.providedItems ?? []) {
      merged.set(item.id, item);
    }
    for (const item of BUILT_IN_ITEMS) {
      merged.set(item.id, item);
    }
    return [...merged.values()].sort(
      (a, b) =>
        (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id),
    );
  });

  protected readonly entries = computed<readonly TopMenuEntry[]>(() =>
    this.items().map((i) => ({ id: i.id, label: i.label })),
  );

  protected readonly openPanelId = signal<string | null>(null);

  protected readonly optionsOpen = computed(
    () => this.openPanelId() === OPTIONS_PANEL_ID,
  );
  protected readonly helpOpen = computed(
    () => this.openPanelId() === HELP_PANEL_ID,
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
    this.openPanelId.update((current) => (current === panelId ? null : panelId));
  }

  protected closePanel(): void {
    this.openPanelId.set(null);
  }
}
