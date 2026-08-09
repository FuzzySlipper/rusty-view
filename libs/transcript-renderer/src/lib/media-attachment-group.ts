import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ChatAttachment } from '@rusty-view/chat-domain';
import { AttachmentBlockComponent } from './attachment-block';

@Component({
  selector: 'rv-media-attachment-group',
  imports: [AttachmentBlockComponent],
  templateUrl: './media-attachment-group.html',
  styleUrl: './media-attachment-group.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaAttachmentGroupComponent {
  readonly attachments = input.required<readonly ChatAttachment[]>();
}
