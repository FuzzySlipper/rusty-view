import {
  ChangeDetectionStrategy,
  Component,
  type OnDestroy,
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
  readonly previewUrl?: string;
  readonly scope: ChatAttachmentScope | undefined;
  readonly source: MessageInputAttachmentSource;
}

export type MessageInputAttachmentStatus =
  | 'uploading'
  | 'uploaded'
  | 'sending'
  | 'removing'
  | 'error';

export interface MessageInputAttachmentState {
  readonly localAttachmentId: string;
  readonly status: MessageInputAttachmentStatus;
  readonly error?: string;
}

export interface MessageInputAttachmentSubmission {
  readonly text: string;
  readonly attachments: readonly MessageInputAttachmentSelection[];
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
export class MessageInputComponent implements OnDestroy {
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
  readonly attachmentStates = input<readonly MessageInputAttachmentState[]>([]);
  readonly send = output<string>();
  readonly sendWithAttachments = output<MessageInputAttachmentSubmission>();
  readonly hintSelected = output<string>();
  readonly attachmentsSelected =
    output<readonly MessageInputAttachmentSelection[]>();
  readonly attachmentRemoved = output<MessageInputAttachmentSelection>();
  readonly attachmentRetry = output<MessageInputAttachmentSelection>();

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

    // Submission history navigation follows terminal-style boundaries. Arrow
    // keys retain normal multiline movement until the caret reaches the first
    // or last line, move to that line's outer edge on the next press, and only
    // enter history on a subsequent press from the absolute start/end.
    if (!isOpen && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const action = this.historyArrowAction(event);
      if (action.kind === 'move-to-edge') {
        event.preventDefault();
        action.target.setSelectionRange(action.position, action.position);
        return;
      }
      if (action.kind === 'navigate') {
        event.preventDefault();
        // ArrowUp = older (index increases), ArrowDown = newer (index decreases).
        this.navigateHistory(event.key === 'ArrowUp' ? 1 : -1);
        if (action.target !== null) {
          // Keep the DOM value and caret in sync immediately so a repeated key
          // press sees the boundary selected for its navigation direction.
          action.target.value = this.text();
          const position =
            event.key === 'ArrowUp' ? 0 : action.target.value.length;
          action.target.setSelectionRange(position, position);
        }
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  private historyArrowAction(event: KeyboardEvent):
    | { readonly kind: 'native' }
    | {
        readonly kind: 'move-to-edge';
        readonly target: HTMLTextAreaElement;
        readonly position: number;
      }
    | {
        readonly kind: 'navigate';
        readonly target: HTMLTextAreaElement | null;
      } {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return { kind: 'native' };
    }
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return { kind: 'navigate', target: null };
    }
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    if (start !== end) return { kind: 'native' };

    if (event.key === 'ArrowUp') {
      if (!hasVisualLineAbove(target, start)) {
        if (start === 0) return { kind: 'navigate', target };
        return { kind: 'move-to-edge', target, position: 0 };
      }
      return { kind: 'native' };
    }

    if (!hasVisualLineBelow(target, end)) {
      if (end === target.value.length) {
        return this.historyIndex() === null
          ? { kind: 'native' }
          : { kind: 'navigate', target };
      }
      return {
        kind: 'move-to-edge',
        target,
        position: target.value.length,
      };
    }
    return { kind: 'native' };
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
    const clipboard = event.clipboardData;
    if (clipboard === null) return;
    const itemFiles = Array.from(clipboard.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const candidates =
      itemFiles.length > 0 ? itemFiles : Array.from(clipboard.files);
    const images = candidates.filter((file) => isComposerImage(file.type));
    if (images.length === 0) return;
    event.preventDefault();
    await this.addFiles(images, 'paste');
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
    const attachments = this.attachments();
    if ((value.length === 0 && attachments.length === 0) || this.disabled()) {
      return;
    }
    if (attachments.length > 0) {
      this.sendWithAttachments.emit({ text: value, attachments });
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
    revokePreviewUrl(selection.previewUrl);
    this.attachmentRemoved.emit(selection);
  }

  protected retryAttachment(selection: MessageInputAttachmentSelection): void {
    this.attachmentRetry.emit(selection);
  }

  protected attachmentState(
    selection: MessageInputAttachmentSelection,
  ): MessageInputAttachmentState | undefined {
    return this.attachmentStates().find(
      (state) => state.localAttachmentId === selection.attachment.id,
    );
  }

  /** Called by the container after the linked message is durably accepted. */
  completeAttachmentSubmission(): void {
    for (const selection of this.attachments()) {
      revokePreviewUrl(selection.previewUrl);
    }
    this.attachments.set([]);
    this.text.set('');
    this.hintOpen.set(false);
    this.historyIndex.set(null);
    this.savedDraft = '';
  }

  ngOnDestroy(): void {
    for (const selection of this.attachments()) {
      revokePreviewUrl(selection.previewUrl);
    }
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
    const previewUrl = createPreviewUrl(file);
    return {
      file,
      scope,
      source,
      ...(previewUrl === undefined ? {} : { previewUrl }),
      attachment: {
        id: attachmentId(file),
        status: 'active',
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

function isComposerImage(mimeType: string): boolean {
  return (
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/webp'
  );
}

function createPreviewUrl(file: File): string | undefined {
  if (
    !isComposerImage(file.type) ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return undefined;
  }
  return URL.createObjectURL(file);
}

function revokePreviewUrl(url: string | undefined): void {
  if (url !== undefined && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

/**
 * Determine whether a caret is on the first/last visual line, including lines
 * introduced by soft wrapping. A textarea does not expose caret rectangles, so
 * a hidden mirror with the same typography and width is used for the browser
 * path. Test/SSR environments without layout fall back to hard-newline lines.
 */
function hasVisualLineAbove(
  target: HTMLTextAreaElement,
  position: number,
): boolean {
  const current = visualLineOffset(target, position);
  const first = visualLineOffset(target, 0);
  if (current === undefined || first === undefined) {
    return fallbackLineIndex(target.value, position) > 0;
  }
  return current > first + 0.5;
}

function hasVisualLineBelow(
  target: HTMLTextAreaElement,
  position: number,
): boolean {
  const current = visualLineOffset(target, position);
  const last = visualLineOffset(target, target.value.length);
  if (current === undefined || last === undefined) {
    return (
      fallbackLineIndex(target.value, position) <
      fallbackLineIndex(target.value, target.value.length)
    );
  }
  return current < last - 0.5;
}

function fallbackLineIndex(value: string, position: number): number {
  return value.slice(0, position).split('\n').length - 1;
}

function visualLineOffset(
  target: HTMLTextAreaElement,
  position: number,
): number | undefined {
  if (
    typeof document === 'undefined' ||
    typeof getComputedStyle !== 'function'
  ) {
    return undefined;
  }

  const width = target.clientWidth || target.getBoundingClientRect().width;
  if (width <= 0) return undefined;

  const computed = getComputedStyle(target);
  const mirror = document.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.left = '-100000px';
  mirror.style.top = '0';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.display = 'block';
  mirror.style.boxSizing = computed.boxSizing;
  mirror.style.width = `${width}px`;
  mirror.style.height = 'auto';
  mirror.style.minHeight = '0';
  mirror.style.maxHeight = 'none';
  mirror.style.padding = computed.padding;
  mirror.style.border = computed.border;
  mirror.style.fontFamily = computed.fontFamily;
  mirror.style.fontSize = computed.fontSize;
  mirror.style.fontWeight = computed.fontWeight;
  mirror.style.fontStyle = computed.fontStyle;
  mirror.style.fontVariant = computed.fontVariant;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.wordSpacing = computed.wordSpacing;
  mirror.style.textIndent = computed.textIndent;
  mirror.style.textAlign = computed.textAlign;
  mirror.style.direction = computed.direction;
  mirror.style.tabSize = computed.tabSize;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordBreak = computed.wordBreak;
  mirror.style.overflowWrap = computed.overflowWrap;

  const prefix = target.value.slice(0, position);
  const marker = document.createElement('span');
  marker.style.display = 'inline-block';
  marker.style.width = '0';
  marker.style.height = '1px';
  marker.style.padding = '0';
  marker.style.margin = '0';
  marker.textContent = '\u200b';
  mirror.append(document.createTextNode(prefix), marker);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const offset = markerRect.top - mirrorRect.top;
  const fallbackOffset = marker.offsetTop;
  mirror.remove();

  if (Number.isFinite(offset) && (offset !== 0 || fallbackOffset === 0)) {
    return offset;
  }
  return Number.isFinite(fallbackOffset) ? fallbackOffset : undefined;
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
