import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import type { ChatAttachment } from '@rusty-view/chat-domain';

type ImageLoadState = 'loading' | 'available' | 'failed';

@Component({
  selector: 'rv-attachment-block',
  templateUrl: './attachment-block.html',
  styleUrl: './attachment-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttachmentBlockComponent {
  readonly attachment = input.required<ChatAttachment>();
  private readonly imageLoadResult = signal<
    | { readonly source: string; readonly state: 'available' | 'failed' }
    | undefined
  >(undefined);

  protected readonly imageSource = computed(
    () => this.attachment().thumbnailUrl ?? this.attachment().url,
  );
  protected readonly imageOpenUrl = computed(
    () => this.attachment().url ?? this.imageSource(),
  );
  protected readonly imageState = computed<ImageLoadState>(() => {
    const source = this.imageSource();
    const result = this.imageLoadResult();
    return source !== undefined && result?.source === source
      ? result.state
      : 'loading';
  });

  protected markImageAvailable(): void {
    const source = this.imageSource();
    if (source !== undefined) {
      this.imageLoadResult.set({ source, state: 'available' });
    }
  }

  protected markImageFailed(): void {
    const source = this.imageSource();
    if (source !== undefined) {
      this.imageLoadResult.set({ source, state: 'failed' });
    }
  }

  protected fileSizeLabel(): string {
    const size = this.attachment().sizeBytes;
    if (size === undefined) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
}
