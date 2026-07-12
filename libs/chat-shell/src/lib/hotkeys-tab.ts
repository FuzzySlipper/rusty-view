import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { hotkeyBindingFromEvent } from '@rusty-view/chat-components';
import {
  HOTKEY_ACTIONS,
  HotkeySettingsService,
  type HotkeyAction,
} from './hotkey-settings';

@Component({
  selector: 'rv-hotkeys-tab',
  templateUrl: './hotkeys-tab.html',
  styleUrl: './hotkeys-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HotkeysTabComponent {
  protected readonly hotkeys = inject(HotkeySettingsService);
  protected readonly actions = HOTKEY_ACTIONS;
  protected readonly recording = signal<HotkeyAction | undefined>(undefined);
  protected readonly feedback = signal<string>('');

  protected startRecording(action: HotkeyAction): void {
    this.recording.set(action);
    this.feedback.set('Press the new shortcut. Escape cancels.');
  }

  protected async capture(event: KeyboardEvent): Promise<void> {
    const action = this.recording();
    if (action === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.recording.set(undefined);
      this.feedback.set('Shortcut recording cancelled.');
      return;
    }
    const binding = hotkeyBindingFromEvent(event);
    if (binding === undefined) return;
    const accepted = await this.hotkeys.setBinding(action, binding);
    if (!accepted) {
      this.feedback.set(`${binding} is invalid or already assigned.`);
      return;
    }
    this.recording.set(undefined);
    this.feedback.set(`${binding} saved.`);
  }

  protected reset(action: HotkeyAction): void {
    void this.hotkeys.reset(action);
    this.feedback.set('Default restored.');
  }

  protected resetAll(): void {
    void this.hotkeys.resetAll();
    this.feedback.set('All defaults restored.');
  }
}
