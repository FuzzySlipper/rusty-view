import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ChatAttachment } from '@rusty-view/chat-domain';

@Component({
  selector: 'rv-attachment-block',
  templateUrl: './attachment-block.html',
  styleUrl: './attachment-block.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttachmentBlockComponent {
  readonly attachment = input.required<ChatAttachment>();

  protected fileSizeLabel(): string {
    const size = this.attachment().sizeBytes;
    if (size === undefined) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
}
