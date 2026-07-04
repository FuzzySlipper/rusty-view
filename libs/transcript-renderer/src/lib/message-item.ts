import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { ChatMessage } from '@rusty-view/chat-domain';

import { CHAT_MESSAGE_DECORATORS } from './transcript-decorators';
import type { ChatMessageDecoration } from './transcript-decorators';
import { MessageBlockComponent } from './message-block';

/**
 * Renders a single {@link ChatMessage} with its author header and blocks.
 *
 * Roleplay-agnostic: applies {@link ChatMessageDecorator}s (if any are
 * provided via {@link CHAT_MESSAGE_DECORATORS}) to add className/prefix/suffix
 * without the renderer knowing about RP concepts.
 */
@Component({
  selector: 'rv-message-item',
  imports: [MessageBlockComponent],
  templateUrl: './message-item.html',
  styleUrl: './message-item.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageItemComponent {
  private readonly decorators = inject(CHAT_MESSAGE_DECORATORS);

  readonly message = input.required<ChatMessage>();
  readonly searchQuery = input<string>('');
  readonly matchedBlockIds = input<ReadonlySet<string>>(new Set<string>());
  readonly searchMatched = input<boolean>(false);
  readonly searchActive = input<boolean>(false);

  protected readonly decoration = computed<ChatMessageDecoration>(() => {
    const message = this.message();
    for (const decorator of this.decorators) {
      if (decorator.canDecorate(message)) {
        return decorator.decorate(message);
      }
    }
    return { className: undefined, prefix: undefined, suffix: undefined };
  });

  protected readonly roleClass = computed(() => {
    const role = this.message().author.role;
    return `rv-message--${role}`;
  });

  protected readonly authorLabel = computed(() => {
    const msg = this.message();
    const name = msg.author.displayName;
    if (name !== undefined) {
      return name;
    }
    return msg.author.role;
  });

  protected readonly timestampLabel = computed(() => {
    const createdAt = this.message().createdAt;
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return createdAt;
    return date.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  });

  protected readonly statusIndicator = computed(() => {
    const status = this.message().status;
    if (status === 'streaming') {
      return 'typing…';
    }
    if (status === 'error') {
      return 'error';
    }
    return '';
  });
}
