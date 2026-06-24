import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

/**
 * Presentational message input: text area with send button and command hints.
 *
 * Enter sends, Shift+Enter inserts a newline. Disabled while `disabled` is
 * true (e.g. during send or when no session is active). No service injection —
 * the parent controls send behavior via the `send` output.
 *
 * When the input starts with `/`, command hints are displayed from the
 * `commands` input. Arrow keys navigate hints, Enter/Tab accepts a hint
 * (inserting it without submitting), Escape closes the hint menu.
 */
@Component({
  selector: 'rv-message-input',
  templateUrl: './message-input.html',
  styleUrl: './message-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageInputComponent {
  readonly disabled = input<boolean>(false);
  readonly placeholder = input<string>('Type a message…');
  readonly commands = input<
    readonly {
      readonly name: string;
      readonly description?: string;
      readonly args_schema?: Record<string, unknown>;
    }[]
  >([]);
  readonly send = output<string>();
  readonly hintSelected = output<string>();

  protected readonly text = signal('');
  protected readonly hintOpen = signal(false);
  protected readonly hintIndex = signal(0);

  protected readonly filteredCommands = computed(() => {
    const text = this.text();
    if (!text.startsWith('/')) return [];
    const query = text.slice(1).toLowerCase();
    return this.commands()
      .filter((cmd) => cmd.name.toLowerCase().startsWith(query))
      .slice(0, 10);
  });

  protected onKeydown(event: KeyboardEvent): void {
    const hints = this.filteredCommands();
    const isOpen = this.hintOpen() && hints.length > 0;

    if (isOpen) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.hintIndex.update((i) => (i + 1) % hints.length);
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.hintIndex.update((i) => (i - 1 + hints.length) % hints.length);
          return;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          this.acceptHint(hints[this.hintIndex()]!.name);
          return;
        case 'Escape':
          event.preventDefault();
          this.hintOpen.set(false);
          return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  protected onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.text.set(target.value);
    this.hintOpen.set(target.value.startsWith('/'));
    this.hintIndex.set(0);
  }

  protected acceptHint(name: string): void {
    this.text.set(`/${name} `);
    this.hintOpen.set(false);
    this.hintSelected.emit(name);
  }

  protected submit(): void {
    const value = this.text().trim();
    if (value.length === 0 || this.disabled()) {
      return;
    }
    this.send.emit(value);
    this.text.set('');
    this.hintOpen.set(false);
  }

  protected hasArgs(schema: Record<string, unknown>): boolean {
    return Object.keys(schema).length > 0;
  }

  protected formatArgs(schema: Record<string, unknown>): string {
    const keys = Object.keys(schema);
    if (keys.length === 0) return '';
    return `[${keys.join(', ')}]`;
  }
}
