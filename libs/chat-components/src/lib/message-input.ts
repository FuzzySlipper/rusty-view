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
  /** Submitted slash commands for Up/Down navigation (newest-first). */
  readonly commandHistory = input<readonly string[]>([]);
  readonly send = output<string>();
  readonly hintSelected = output<string>();

  protected readonly text = signal('');
  protected readonly hintOpen = signal(false);
  protected readonly hintIndex = signal(0);
  /** null = not navigating history; number = index into commandHistory(). */
  protected readonly historyIndex = signal<number | null>(null);
  /** Draft preserved when the user enters history navigation. */
  protected savedDraft = '';

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
          {
            const selected = hints[this.hintIndex()];
            if (selected) this.acceptHint(selected.name);
          }
          return;
        case 'Escape':
          event.preventDefault();
          this.hintOpen.set(false);
          return;
      }
    }

    // Command history navigation (only when hints are closed and the text is
    // empty or a slash command — never clobber a half-typed normal message).
    if (!isOpen && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const value = this.text();
      const isCommandContext =
        value.length === 0 || value.startsWith('/');
      if (isCommandContext) {
        event.preventDefault();
        // ArrowUp = older (index increases), ArrowDown = newer (index decreases).
        this.navigateHistory(event.key === 'ArrowUp' ? 1 : -1);
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
    // Typing exits history navigation mode.
    this.historyIndex.set(null);
  }

  protected acceptHint(name: string): void {
    this.text.set(`/${name} `);
    this.hintOpen.set(false);
    this.hintSelected.emit(name);
  }

  /**
   * Navigate command history. `delta` +1 = older (ArrowUp), -1 = newer
   * (ArrowDown). History is newest-first, so older = higher index.
   *
   * Enters history mode on first navigation, preserving the current draft.
   * Exiting past the newest entry (index < 0) restores the saved draft.
   * Clamps at the oldest entry (index >= length).
   */
  protected navigateHistory(delta: 1 | -1): void {
    const history = this.commandHistory();
    if (history.length === 0) return;

    const currentIndex = this.historyIndex();

    // Enter history mode: save current draft.
    if (currentIndex === null) {
      this.savedDraft = this.text();
      const startIndex = delta === 1 ? 0 : history.length - 1;
      const entry = history[startIndex];
      if (entry !== undefined) {
        this.historyIndex.set(startIndex);
        this.text.set(entry);
      }
      return;
    }

    const next = currentIndex + delta;

    // Past the newest (index < 0): exit history mode, restore draft.
    if (next < 0) {
      this.historyIndex.set(null);
      this.text.set(this.savedDraft);
      this.savedDraft = '';
      return;
    }

    // Past the oldest (index >= length): clamp (stay at oldest).
    if (next >= history.length) {
      const oldest = history[history.length - 1];
      if (oldest !== undefined) this.text.set(oldest);
      return;
    }

    const entry = history[next];
    if (entry !== undefined) {
      this.historyIndex.set(next);
      this.text.set(entry);
    }
  }

  protected submit(): void {
    const value = this.text().trim();
    if (value.length === 0 || this.disabled()) {
      return;
    }
    this.send.emit(value);
    this.text.set('');
    this.hintOpen.set(false);
    this.historyIndex.set(null);
    this.savedDraft = '';
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
