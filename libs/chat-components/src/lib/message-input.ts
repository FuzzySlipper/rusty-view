import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  attachmentKindForMimeType,
  type ChatAttachment,
  type ChatAttachmentScope,
} from '@rusty-view/chat-domain';
import { TooltipDirective } from './tooltip';
import { matchesHotkey } from './hotkeys';

export type MessageInputAttachmentSource = 'picker' | 'paste' | 'drop';

export interface MessageInputAttachmentSelection {
  readonly file: File;
  readonly attachment: ChatAttachment;
  readonly scope: ChatAttachmentScope | undefined;
  readonly source: MessageInputAttachmentSource;
}

export interface MessageInputCommandArgumentValue {
  readonly value: string;
  readonly label?: string;
  readonly description?: string;
}

export interface MessageInputCommandDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly args_schema?: Record<string, unknown>;
  readonly argumentValues?: readonly MessageInputCommandArgumentValue[];
}

const TEXT_PREVIEW_LIMIT = 2_000;

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
  imports: [TooltipDirective],
  templateUrl: './message-input.html',
  styleUrl: './message-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageInputComponent {
  readonly disabled = input<boolean>(false);
  readonly erasePreviousWordHotkey = input<string>('Ctrl+W');
  readonly placeholder = input<string>('Type a message…');
  readonly commands = input<readonly MessageInputCommandDescriptor[]>([]);
  /** @deprecated Use submissionHistory for ordinary prompts and commands. */
  readonly commandHistory = input<readonly string[]>([]);
  /** Submitted prompts and commands for Up/Down navigation (newest-first). */
  readonly submissionHistory = input<readonly string[] | undefined>(undefined);
  readonly attachmentsEnabled = input<boolean>(false);
  readonly attachmentScopes = input<readonly ChatAttachmentScope[]>([]);
  readonly send = output<string>();
  readonly hintSelected = output<string>();
  readonly attachmentsSelected =
    output<readonly MessageInputAttachmentSelection[]>();
  readonly attachmentRemoved = output<MessageInputAttachmentSelection>();

  protected readonly text = signal('');
  protected readonly hintOpen = signal(false);
  protected readonly hintIndex = signal(0);
  protected readonly dragActive = signal(false);
  protected readonly selectedScopeId = signal<string | undefined>(undefined);
  protected readonly attachments = signal<
    readonly MessageInputAttachmentSelection[]
  >([]);
  /** null = not navigating history; number = index into effectiveHistory(). */
  protected readonly historyIndex = signal<number | null>(null);
  /** Draft preserved when the user enters history navigation. */
  protected savedDraft = '';

  protected readonly filteredCommands = computed<
    readonly MessageInputCommandDescriptor[]
  >(() => {
    const text = this.text();
    if (!text.startsWith('/')) return [];
    const commandInput = text.slice(1);
    const separator = commandInput.search(/\s/);
    if (separator >= 0) {
      const commandName = commandInput.slice(0, separator).toLowerCase();
      const argumentQuery = commandInput
        .slice(separator)
        .trimStart()
        .toLowerCase();
      const command = this.commands().find(
        (candidate) => candidate.name.toLowerCase() === commandName,
      );
      return (command?.argumentValues ?? [])
        .filter((choice) =>
          choice.value.toLowerCase().startsWith(argumentQuery),
        )
        .slice(0, 10)
        .map((choice) => {
          const description = choice.description ?? command?.description;
          return {
            name: `${command?.name ?? commandName} ${choice.value}`,
            ...(description === undefined ? {} : { description }),
          };
        });
    }
    const query = commandInput.toLowerCase();
    return this.commands()
      .filter((cmd) => cmd.name.toLowerCase().startsWith(query))
      .slice(0, 10);
  });

  protected readonly activeScope = computed(() => {
    const scopes = this.attachmentScopes();
    return (
      scopes.find((scope) => scope.id === this.selectedScopeId()) ?? scopes[0]
    );
  });

  protected readonly accept = computed(() => this.activeScope()?.accept);

  private readonly effectiveHistory = computed(
    () => this.submissionHistory() ?? this.commandHistory(),
  );

  protected onKeydown(event: KeyboardEvent): void {
    if (matchesHotkey(event, this.erasePreviousWordHotkey())) {
      event.preventDefault();
      this.erasePreviousWord(event.target);
      return;
    }
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

    // Submission history navigation. Multiline drafts retain normal cursor
    // movement until the caret reaches the first/last line.
    if (!isOpen && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (this.canNavigateHistory(event)) {
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

  private canNavigateHistory(event: KeyboardEvent): boolean {
    if (this.historyIndex() !== null) return true;
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return true;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    if (event.key === 'ArrowUp') {
      return !target.value.slice(0, start).includes('\n');
    }
    return !target.value.slice(end).includes('\n');
  }

  private erasePreviousWord(target: EventTarget | null): void {
    if (!(target instanceof HTMLTextAreaElement)) return;
    const selectionStart = target.selectionStart ?? target.value.length;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    let deleteStart = selectionStart;
    if (selectionStart === selectionEnd) {
      const prefix = target.value.slice(0, selectionStart);
      const word = /\S+\s*$/.exec(prefix);
      const whitespace = /\s+$/.exec(prefix);
      deleteStart = word?.index ?? whitespace?.index ?? selectionStart;
    }
    target.setRangeText('', deleteStart, selectionEnd, 'end');
    this.text.set(target.value);
    this.historyIndex.set(null);
  }

  protected onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.text.set(target.value);
    this.hintOpen.set(target.value.startsWith('/'));
    this.hintIndex.set(0);
    // Typing exits history navigation mode.
    this.historyIndex.set(null);
  }

  protected updateScope(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedScopeId.set(target.value || undefined);
  }

  protected async onFileInput(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    await this.addFiles(target.files, 'picker');
    target.value = '';
  }

  protected async onPaste(event: ClipboardEvent): Promise<void> {
    if (!this.attachmentsEnabled()) return;
    const files = event.clipboardData?.files;
    if (files === undefined || files.length === 0) return;
    await this.addFiles(files, 'paste');
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.attachmentsEnabled()) return;
    event.preventDefault();
    this.dragActive.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    if (!this.attachmentsEnabled()) return;
    if (event.currentTarget === event.target) {
      this.dragActive.set(false);
    }
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    if (!this.attachmentsEnabled()) return;
    event.preventDefault();
    this.dragActive.set(false);
    await this.addFiles(event.dataTransfer?.files, 'drop');
  }

  protected acceptHint(name: string): void {
    this.text.set(`/${name} `);
    const selected = this.commands().find(
      (command) => command.name.toLowerCase() === name.toLowerCase(),
    );
    this.hintOpen.set((selected?.argumentValues?.length ?? 0) > 0);
    this.hintSelected.emit(name);
  }

  /**
   * Navigate submission history. `delta` +1 = older (ArrowUp), -1 = newer
   * (ArrowDown). History is newest-first, so older = higher index.
   *
   * Enters history mode on first navigation, preserving the current draft.
   * Exiting past the newest entry (index < 0) restores the saved draft.
   * Clamps at the oldest entry (index >= length).
   */
  protected navigateHistory(delta: 1 | -1): void {
    const history = this.effectiveHistory();
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

  protected removeAttachment(selection: MessageInputAttachmentSelection): void {
    this.attachments.update((items) =>
      items.filter((item) => item.attachment.id !== selection.attachment.id),
    );
    this.attachmentRemoved.emit(selection);
  }

  protected hasArgs(schema: Record<string, unknown>): boolean {
    return Object.keys(schema).length > 0;
  }

  protected formatArgs(schema: Record<string, unknown>): string {
    const keys = Object.keys(schema);
    if (keys.length === 0) return '';
    return `[${keys.join(', ')}]`;
  }

  private async addFiles(
    files: FileList | readonly File[] | null | undefined,
    source: MessageInputAttachmentSource,
  ): Promise<void> {
    if (files === undefined || files === null || files.length === 0) return;

    const scope = this.activeScope();
    const selections = await Promise.all(
      Array.from(files).map((file) =>
        this.selectionForFile(file, source, scope),
      ),
    );
    const usableSelections =
      scope?.multiple === false ? selections.slice(0, 1) : selections;
    this.attachments.update((items) =>
      scope?.multiple === false
        ? usableSelections
        : [...items, ...usableSelections],
    );
    this.attachmentsSelected.emit(usableSelections);
  }

  private async selectionForFile(
    file: File,
    source: MessageInputAttachmentSource,
    scope: ChatAttachmentScope | undefined,
  ): Promise<MessageInputAttachmentSelection> {
    const mimeType = file.type || undefined;
    return {
      file,
      scope,
      source,
      attachment: {
        id: attachmentId(file),
        kind: attachmentKindForMimeType(mimeType),
        name: file.name || 'untitled',
        mimeType,
        sizeBytes: file.size,
        url: undefined,
        thumbnailUrl: undefined,
        textPreview: await textPreviewForFile(file),
        scopeId: scope?.id,
      },
    };
  }
}

function attachmentId(file: File): string {
  return [
    'attachment',
    file.name || 'untitled',
    file.size,
    file.lastModified,
    Math.random().toString(36).slice(2, 8),
  ].join('_');
}

async function textPreviewForFile(
  file: File,
): Promise<ChatAttachment['textPreview']> {
  if (!isTextLikeFile(file)) return undefined;

  const text = await readFileText(file);
  if (text === undefined) return undefined;
  return {
    text: text.slice(0, TEXT_PREVIEW_LIMIT),
    truncated: text.length > TEXT_PREVIEW_LIMIT,
  };
}

function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(json|md|markdown|txt|csv|log|xml|yaml|yml)$/i.test(file.name);
}

function readFileText(file: File): Promise<string | undefined> {
  const textMethod = (file as File & { text?: () => Promise<string> }).text;
  if (typeof textMethod === 'function') {
    return textMethod.call(file);
  }
  if (typeof FileReader === 'undefined') {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : undefined);
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsText(file);
  });
}
