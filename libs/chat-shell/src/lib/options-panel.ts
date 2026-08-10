import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { TabStripComponent, type TabEntry } from '@rusty-view/chat-components';

import { AppearanceTabComponent } from './appearance-tab';
import { GeneralSettingsTabComponent } from './general-settings-tab';
import { HotkeysTabComponent } from './hotkeys-tab';
import {
  CHAT_OPTIONS_TABS,
  type ChatOptionsTab,
} from './shell-extension-tokens';

/** Built-in tabs the Options panel always ships with. */
const BUILT_IN_TABS: readonly ChatOptionsTab[] = [
  {
    id: 'general',
    label: 'General',
    order: 0,
    component: GeneralSettingsTabComponent,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    order: 10,
    component: AppearanceTabComponent,
  },
  {
    id: 'hotkeys',
    label: 'Hotkeys',
    order: 20,
    component: HotkeysTabComponent,
  },
];

/**
 * Options panel: a tabbed surface for app preferences.
 *
 * Container component — reads the {@link CHAT_OPTIONS_TABS} multi-provider,
 * merges it with the built-in `appearance` tab (built-in wins on id clashes),
 * and renders the active tab's component via `NgComponentOutlet`. Downstream
 * consumers add tabs by providing more entries; they never fork the panel.
 */
@Component({
  selector: 'rv-options-panel',
  imports: [NgComponentOutlet, TabStripComponent],
  templateUrl: './options-panel.html',
  styleUrl: './options-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionsPanelComponent {
  private readonly providedTabs = inject(CHAT_OPTIONS_TABS, { optional: true });

  protected readonly tabs = computed<readonly ChatOptionsTab[]>(() => {
    const merged = new Map<string, ChatOptionsTab>();
    // Provided tabs first, then built-ins override reserved ids.
    for (const tab of this.providedTabs ?? []) {
      merged.set(tab.id, tab);
    }
    for (const tab of BUILT_IN_TABS) {
      merged.set(tab.id, tab);
    }
    return [...merged.values()].sort(
      (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id),
    );
  });

  protected readonly tabEntries = computed<readonly TabEntry[]>(() =>
    this.tabs().map((t) => ({ id: t.id, label: t.label })),
  );

  protected readonly activeId = signal<string>('appearance');

  protected readonly activeComponent = computed(
    () => this.tabs().find((t) => t.id === this.activeId())?.component,
  );

  /** Emits when the user dismisses the panel. */
  readonly dismissed = output<void>();

  protected onSelectTab(id: string): void {
    this.activeId.set(id);
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }
}
