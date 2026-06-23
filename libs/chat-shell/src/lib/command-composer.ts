import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ChatStore } from '@rusty-view/chat-store';

/**
 * Command composer for the debug app. Slash command input backed by the
 * command registry from the store. Supports direct raw command mode for
 * debug operations like /new and /reload-mcp.
 *
 * Container component — injects ChatStore to read the command registry and
 * execute commands.
 */
@Component({
  selector: 'rv-command-composer',
  templateUrl: './command-composer.html',
  styleUrl: './command-composer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandComposerComponent {
  protected readonly store = inject(ChatStore);

  protected readonly commandText = signal('');
  protected readonly showRegistry = signal(false);

  protected readonly availableCommands = computed(() => this.store.commands());

  protected submit(): void {
    const cmd = this.commandText().trim();
    if (cmd.length === 0) return;
    void this.store.runCommand(cmd);
    this.commandText.set('');
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submit();
    }
  }

  protected toggleRegistry(): void {
    this.showRegistry.update((v) => !v);
  }

  protected fillCommand(name: string): void {
    this.commandText.set(name);
    this.showRegistry.set(false);
  }
}
