import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { ChatAttachment } from '@rusty-view/chat-domain';
import { ATTACHMENT_CONTENT_LOADER } from './content-renderers';
import { WorkerManager } from './worker-manager';

type DocumentLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'available';
      readonly identity: string;
      readonly completeText: string;
      readonly previewText: string;
      readonly renderedMarkdown: string | undefined;
      readonly downloadUrl: string;
      readonly truncated: boolean;
    };

const MAX_RENDERED_DOCUMENT_CHARACTERS = 256_000;
const MAX_RENDERED_SOURCE_LINES = 5_000;

@Component({
  selector: 'rv-document-attachment',
  templateUrl: './document-attachment.html',
  styleUrl: './document-attachment.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class DocumentAttachmentComponent {
  readonly attachment = input.required<ChatAttachment>();
  private readonly contentLoader = inject(ATTACHMENT_CONTENT_LOADER, {
    optional: true,
  });
  private readonly workerManager = inject(WorkerManager);
  private readonly retryRevision = signal(0);
  protected readonly previewOpen = signal(false);
  protected readonly copied = signal(false);
  protected readonly loadState = signal<DocumentLoadState>({ status: 'idle' });

  private readonly loadDocument = effect((onCleanup) => {
    const attachment = this.attachment();
    const open = this.previewOpen();
    this.retryRevision();
    if (
      !open ||
      attachment.status === 'removed' ||
      attachment.contentState !== 'available' ||
      attachment.contentLoadPolicy !== 'authenticated_lazy' ||
      attachment.url === undefined ||
      this.contentLoader === null
    ) {
      this.loadState.set({ status: 'idle' });
      return;
    }

    const identity = documentContentIdentity(attachment);
    const controller = new AbortController();
    let cancelled = false;
    let downloadUrl: string | undefined;
    this.loadState.set({ status: 'loading' });
    void this.contentLoader(attachment, controller.signal)
      .then(async (blob) => {
        if (cancelled) return;
        downloadUrl = URL.createObjectURL(blob);
        const completeText = await readBlobText(blob, controller.signal);
        if (cancelled || downloadUrl === undefined) return;
        const previewText = completeText.slice(
          0,
          MAX_RENDERED_DOCUMENT_CHARACTERS,
        );
        const renderedMarkdown = isMarkdownAttachment(attachment)
          ? await this.workerManager.parseMarkdown(previewText)
          : undefined;
        if (cancelled) return;
        this.loadState.set({
          status: 'available',
          identity,
          completeText,
          previewText,
          renderedMarkdown,
          downloadUrl,
          truncated: completeText.length > previewText.length,
        });
      })
      .catch((error: unknown) => {
        if (cancelled || isAbortError(error)) return;
        this.loadState.set({ status: 'failed' });
      });

    onCleanup(() => {
      cancelled = true;
      controller.abort();
      if (downloadUrl !== undefined) URL.revokeObjectURL(downloadUrl);
    });
  });

  protected readonly canOpen = computed(() => {
    const attachment = this.attachment();
    return (
      attachment.status !== 'removed' &&
      attachment.contentState === 'available' &&
      attachment.url !== undefined &&
      this.contentLoader !== null
    );
  });

  protected readonly sourceLines = computed(() => {
    const state = this.loadState();
    if (state.status !== 'available' || state.renderedMarkdown !== undefined) {
      return [];
    }
    return state.previewText.split('\n').slice(0, MAX_RENDERED_SOURCE_LINES);
  });

  protected readonly shortRevision = computed(() =>
    this.attachment().contentSha256?.slice(0, 12),
  );

  protected readonly languageLabel = computed(() => {
    const value = this.attachment().metadata?.['languageHint'];
    return typeof value === 'string' ? value : undefined;
  });

  protected openPreview(): void {
    if (this.canOpen()) this.previewOpen.set(true);
  }

  protected closePreview(): void {
    this.previewOpen.set(false);
    this.copied.set(false);
  }

  @HostListener('document:keydown.escape')
  protected closePreviewOnEscape(): void {
    this.closePreview();
  }

  protected retryLoad(): void {
    this.retryRevision.update((revision) => revision + 1);
  }

  protected copyDocument(): void {
    const state = this.loadState();
    if (state.status !== 'available') return;
    void copyText(state.completeText).then((copied) => this.copied.set(copied));
  }

  protected stateLabel(): string {
    const attachment = this.attachment();
    if (attachment.status === 'removed') return 'Checkpoint removed';
    switch (attachment.contentState) {
      case undefined:
        return 'Checkpoint pending';
      case 'available':
        return 'Checkpoint available';
      case 'missing':
        return 'File was missing when captured';
      case 'binary':
        return 'Binary content cannot be previewed';
      case 'empty':
        return 'File was empty when captured';
      case 'oversized':
        return 'File exceeded the capture limit';
      case 'changed':
        return 'File changed before capture completed';
      case 'unsupported':
        return 'File type is unsupported';
      case 'failed':
        return 'File capture failed';
      case 'unavailable':
        return 'Checkpoint unavailable';
    }
    return 'Checkpoint unavailable';
  }

  protected fileSizeLabel(): string {
    const size = this.attachment().sizeBytes;
    if (size === undefined) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
}

function documentContentIdentity(attachment: ChatAttachment): string {
  return [attachment.id, attachment.url, attachment.contentSha256].join(':');
}

function isMarkdownAttachment(attachment: ChatAttachment): boolean {
  const language = attachment.metadata?.['languageHint'];
  return (
    language === 'markdown' ||
    attachment.mimeType === 'text/markdown' ||
    /\.(md|markdown|mdown)$/i.test(attachment.name)
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function readBlobText(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const abort = (): void => reader.abort();
    signal.addEventListener('abort', abort, { once: true });
    reader.addEventListener(
      'load',
      () => {
        signal.removeEventListener('abort', abort);
        resolve(typeof reader.result === 'string' ? reader.result : '');
      },
      { once: true },
    );
    reader.addEventListener(
      'error',
      () => {
        signal.removeEventListener('abort', abort);
        reject(reader.error ?? new Error('Checkpoint text decoding failed.'));
      },
      { once: true },
    );
    reader.addEventListener(
      'abort',
      () => {
        signal.removeEventListener('abort', abort);
        reject(new DOMException('Checkpoint load aborted.', 'AbortError'));
      },
      { once: true },
    );
    reader.readAsText(blob, 'utf-8');
  });
}

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
