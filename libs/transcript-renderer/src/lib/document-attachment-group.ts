import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ChatAttachment } from '@rusty-view/chat-domain';
import { DocumentAttachmentComponent } from './document-attachment';

@Component({
  selector: 'rv-document-attachment-group',
  imports: [DocumentAttachmentComponent],
  templateUrl: './document-attachment-group.html',
  styleUrl: './document-attachment-group.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentAttachmentGroupComponent {
  readonly attachments = input.required<readonly ChatAttachment[]>();
}
