import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type {
  ChatMessage,
  MessageAlternateSlot,
  MessageSpeakerIdentity,
} from '@rusty-view/chat-domain';

import { CHAT_MESSAGE_DECORATORS } from './transcript-decorators';
import type { ChatMessageDecoration } from './transcript-decorators';
import { MessageBlockComponent } from './message-block';
import {
  MessageRevisionControlsComponent,
  type MessageRevisionAction,
  type MessageRevisionCapabilities,
} from './message-revision-controls';

/**
 * Renders a single {@link ChatMessage} with its author header and blocks.
 *
 * Roleplay-agnostic: applies {@link ChatMessageDecorator}s (if any are
 * provided via {@link CHAT_MESSAGE_DECORATORS}) to add className/prefix/suffix
 * without the renderer knowing about RP concepts.
 */
@Component({
  selector: 'rv-message-item',
  imports: [MessageBlockComponent, MessageRevisionControlsComponent],
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
  readonly alternateSlot = input<MessageAlternateSlot | undefined>(undefined);
  readonly revisionCapabilities = input<MessageRevisionCapabilities>({});
  readonly showRevisionActions = input<boolean>(true);
  readonly autoExpandReasoning = input<boolean>(false);
  readonly revisionAction = output<MessageRevisionAction>();

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

  protected readonly speaker = computed<Required<MessageSpeakerIdentity>>(
    () => {
      const message = this.message();
      const decorated = this.decoration().speaker;
      const base = message.author.speaker;
      const label =
        decorated?.label ??
        base?.label ??
        message.author.displayName ??
        message.author.role;
      const initials =
        decorated?.initials ?? base?.initials ?? initialsFor(label);
      const avatarAlt =
        decorated?.avatarAlt ??
        base?.avatarAlt ??
        (label.length === 0 ? 'Speaker avatar' : `Avatar for ${label}`);

      return {
        label,
        avatarUrl: decorated?.avatarUrl ?? base?.avatarUrl ?? '',
        initials,
        avatarAlt,
      };
    },
  );

  protected readonly authorLabel = computed(() => {
    return this.speaker().label;
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
      return this.message().metadata?.['deliveryStatus'] === 'sending'
        ? 'sending…'
        : 'typing…';
    }
    if (status === 'error') {
      return 'error';
    }
    return '';
  });

  protected readonly messagePhase = computed(() => {
    const phase = this.message().metadata?.['messagePhase'];
    return phase === 'commentary' ||
      phase === 'final_answer' ||
      phase === 'unknown'
      ? phase
      : undefined;
  });

  protected readonly messagePhaseLabel = computed(() => {
    const phase = this.messagePhase();
    return phase === 'commentary'
      ? 'Commentary'
      : phase === 'final_answer'
        ? 'Final answer'
        : phase === 'unknown'
          ? 'Agent message'
          : this.message().metadata?.['externalAgentText'] === true
            ? 'Agent message'
            : '';
  });

  protected readonly deliveryFailure = computed<
    DeliveryFailureView | undefined
  >(() => deliveryFailureView(this.message().metadata?.['deliveryFailure']));

  protected readonly showRevisionControls = computed(
    () =>
      this.message().author.role === 'assistant' &&
      (this.showRevisionActions() ||
        (this.alternateSlot()?.alternates.length ?? 0) > 0),
  );

  protected onRevisionAction(action: MessageRevisionAction): void {
    this.revisionAction.emit(action);
  }
}

interface DeliveryFailureView {
  readonly operation: string;
  readonly endpoint: string;
  readonly message: string;
  readonly reasonCode?: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
}

function deliveryFailureView(value: unknown): DeliveryFailureView | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  const operation = record['operation'];
  const endpoint = record['endpoint'];
  const message = record['message'];
  const retryable = record['retryable'];
  if (
    typeof operation !== 'string' ||
    typeof endpoint !== 'string' ||
    typeof message !== 'string' ||
    typeof retryable !== 'boolean'
  ) {
    return undefined;
  }
  const reasonCode = record['reasonCode'];
  const statusCode = record['statusCode'];
  return {
    operation,
    endpoint,
    message,
    retryable,
    ...(typeof reasonCode === 'string' ? { reasonCode } : {}),
    ...(typeof statusCode === 'number' ? { statusCode } : {}),
  };
}

function initialsFor(label: string): string {
  const words = label
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    return (words[0] ?? '?').slice(0, 2).toUpperCase();
  }
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase() || '?';
}
