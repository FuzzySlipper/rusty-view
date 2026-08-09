import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { AfterViewInit, OnDestroy } from '@angular/core';
import type { ChatAttachment } from '@rusty-view/chat-domain';
import { ATTACHMENT_CONTENT_LOADER } from './content-renderers';

type ImageLoadState =
  | 'deferred'
  | 'loading'
  | 'available'
  | 'failed'
  | 'unavailable';

@Component({
  selector: 'rv-attachment-block',
  templateUrl: './attachment-block.html',
  styleUrl: './attachment-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttachmentBlockComponent implements AfterViewInit, OnDestroy {
  readonly attachment = input.required<ChatAttachment>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly contentLoader = inject(ATTACHMENT_CONTENT_LOADER, {
    optional: true,
  });
  private observer: IntersectionObserver | undefined;
  private readonly visible = signal(false);
  private readonly retryRevision = signal(0);
  private readonly loadedContent = signal<
    | { readonly identity: string; readonly source: string }
    | { readonly identity: string; readonly failed: true }
    | undefined
  >(undefined);
  private readonly decodedImage = signal<
    | { readonly source: string; readonly state: 'available' | 'failed' }
    | undefined
  >(undefined);
  protected readonly previewOpen = signal(false);
  private readonly previewCloseButton =
    viewChild<ElementRef<HTMLButtonElement>>('previewCloseButton');

  private readonly loadContent = effect((onCleanup) => {
    const attachment = this.attachment();
    const visible = this.visible();
    this.retryRevision();
    if (
      attachment.kind !== 'image' ||
      attachment.status === 'removed' ||
      attachment.contentState !== 'available' ||
      attachment.contentLoadPolicy !== 'authenticated_lazy' ||
      attachment.url === undefined ||
      this.contentLoader === null ||
      !visible
    ) {
      return;
    }
    const identity = attachmentContentIdentity(attachment);
    const controller = new AbortController();
    let cancelled = false;
    let objectUrl: string | undefined;
    this.loadedContent.set(undefined);
    void this.contentLoader(attachment, controller.signal)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        this.loadedContent.set({ identity, source: objectUrl });
      })
      .catch((error: unknown) => {
        if (cancelled || isAbortError(error)) return;
        this.loadedContent.set({ identity, failed: true });
      });
    onCleanup(() => {
      cancelled = true;
      controller.abort();
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    });
  });

  private readonly focusPreview = effect(() => {
    if (this.previewOpen()) this.previewCloseButton()?.nativeElement.focus();
  });

  protected readonly imageSource = computed(() => {
    const attachment = this.attachment();
    if (attachment.contentLoadPolicy !== 'authenticated_lazy') {
      return attachment.thumbnailUrl ?? attachment.url;
    }
    const loaded = this.loadedContent();
    const identity = attachmentContentIdentity(attachment);
    return loaded?.identity === identity && 'source' in loaded
      ? loaded.source
      : undefined;
  });

  protected readonly fullImageSource = computed(() => {
    const attachment = this.attachment();
    return attachment.contentLoadPolicy === 'authenticated_lazy'
      ? this.imageSource()
      : (attachment.url ?? attachment.thumbnailUrl);
  });

  protected readonly imageState = computed<ImageLoadState>(() => {
    const attachment = this.attachment();
    if (
      attachment.status === 'removed' ||
      (attachment.contentState !== undefined &&
        attachment.contentState !== 'available') ||
      attachment.url === undefined
    ) {
      return 'unavailable';
    }
    if (
      attachment.contentLoadPolicy === 'authenticated_lazy' &&
      !this.visible()
    ) {
      return 'deferred';
    }
    const loaded = this.loadedContent();
    const identity = attachmentContentIdentity(attachment);
    if (
      attachment.contentLoadPolicy === 'authenticated_lazy' &&
      loaded?.identity === identity &&
      'failed' in loaded
    ) {
      return 'failed';
    }
    const source = this.imageSource();
    if (source === undefined) return 'loading';
    const decoded = this.decodedImage();
    return decoded?.source === source ? decoded.state : 'loading';
  });

  protected readonly imageAspectRatio = computed(() => {
    const attachment = this.attachment();
    return attachment.width !== undefined && attachment.height !== undefined
      ? `${attachment.width} / ${attachment.height}`
      : undefined;
  });

  protected readonly dimensionsLabel = computed(() => {
    const attachment = this.attachment();
    return attachment.width !== undefined && attachment.height !== undefined
      ? `${attachment.width}×${attachment.height}`
      : '';
  });

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.visible.set(true);
          this.observer?.disconnect();
          this.observer = undefined;
        }
      },
      { rootMargin: '240px 0px' },
    );
    this.observer.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  @HostListener('document:keydown.escape')
  protected closePreviewOnEscape(): void {
    this.previewOpen.set(false);
  }

  protected markImageAvailable(): void {
    const source = this.imageSource();
    if (source !== undefined) {
      this.decodedImage.set({ source, state: 'available' });
    }
  }

  protected markImageFailed(): void {
    const source = this.imageSource();
    if (source !== undefined) {
      this.decodedImage.set({ source, state: 'failed' });
    }
  }

  protected openPreview(): void {
    if (this.imageState() === 'available') this.previewOpen.set(true);
  }

  protected closePreview(): void {
    this.previewOpen.set(false);
  }

  protected closePreviewFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closePreview();
  }

  protected retryImage(): void {
    this.retryRevision.update((revision) => revision + 1);
  }

  protected unavailableLabel(): string {
    const state = this.attachment().contentState;
    if (state === 'unsupported') return 'Image format unsupported';
    if (state === 'empty') return 'Image was empty';
    if (state === 'oversized') return 'Image exceeded the size limit';
    if (state === 'failed') return 'Image capture failed';
    return 'Image unavailable';
  }

  protected fileSizeLabel(): string {
    const size = this.attachment().sizeBytes;
    if (size === undefined) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
}

function attachmentContentIdentity(attachment: ChatAttachment): string {
  return [attachment.id, attachment.url, attachment.contentSha256].join(':');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
