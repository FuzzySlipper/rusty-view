import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ChatStore } from '@rusty-view/chat-store';
import type { ChatCommandDescriptor } from '@rusty-view/protocol';
import {
  CHAT_SLASH_COMMANDS,
  type ChatPluginCommandResult,
} from './plugin-api';
import {
  executeSlashCommand,
  findSlashCommand,
  normalizeSlashCommandText,
  pluginCommandDescriptor,
} from './slash-command-runtime';

/**
 * Command composer for the operator app. Slash command input backed by the
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
  private readonly slashCommands =
    inject(CHAT_SLASH_COMMANDS, { optional: true }) ?? [];

  protected readonly commandText = signal('');
  protected readonly showRegistry = signal(false);
  protected readonly isExecuting = signal(false);
  protected readonly lastResult = signal<ChatPluginCommandResult | undefined>(
    undefined,
  );

  protected readonly availableCommands = computed<
    readonly ChatCommandDescriptor[]
  >(() => [
    ...this.store.commands(),
    ...this.slashCommands.map((command) => pluginCommandDescriptor(command)),
  ]);

  protected submit(): void {
    const cmd = normalizeSlashCommandText(this.commandText());
    if (cmd.length === 0) return;
    if (this.hasPluginCommand(cmd)) {
      void this.runPluginCommand(cmd);
      return;
    }

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
    this.commandText.set(`/${name} `);
    this.showRegistry.set(false);
  }

  private hasPluginCommand(text: string): boolean {
    const name = text.trim().split(/\s+/, 1)[0]?.slice(1);
    return (
      name !== undefined &&
      findSlashCommand(this.slashCommands, name) !== undefined
    );
  }

  private async runPluginCommand(text: string): Promise<void> {
    this.isExecuting.set(true);
    this.lastResult.set(undefined);

    try {
      const result = await executeSlashCommand(text, this.slashCommands, {
        sessionId: this.store.activeSessionId() ?? undefined,
        messageId: undefined,
        selectedText: undefined,
        piped: undefined,
        signal: undefined,
        confirm: async (policy) =>
          confirmCommand(policy.message ?? policy.title),
      });
      this.lastResult.set(result);
      if (result.type !== 'error' && result.type !== 'abort') {
        this.store.recordCommand(text);
        this.commandText.set('');
      }
    } finally {
      this.isExecuting.set(false);
    }
  }
}

function confirmCommand(message: string | undefined): Promise<boolean> {
  if (typeof globalThis.confirm === 'function') {
    return Promise.resolve(globalThis.confirm(message ?? 'Run command?'));
  }
  return Promise.resolve(true);
}
