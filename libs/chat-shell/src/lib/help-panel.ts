import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ChatStore } from '@rusty-view/chat-store';

/**
 * Help panel: lists every command available in the current command registry.
 *
 * Container component — injects {@link ChatStore} to read the live command
 * registry (sourced from the backend transport, never a hard-coded duplicate).
 * Renders name, aliases, description, scope, and a read-only/mutating badge
 * for each command.
 */
@Component({
  selector: 'rv-help-panel',
  templateUrl: './help-panel.html',
  styleUrl: './help-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpPanelComponent {
  protected readonly store = inject(ChatStore);

  protected readonly commands = computed(() => this.store.commands());

  /** Render the args_schema JSON compactly, or a placeholder when absent. */
  protected argsLabel(cmd: {
    readonly args_schema?: { readonly [key: string]: unknown };
  }): string {
    const schema = cmd.args_schema;
    if (schema === undefined) return '—';
    const keys = Object.keys(schema);
    return keys.length === 0 ? 'none' : keys.join(', ');
  }
}
