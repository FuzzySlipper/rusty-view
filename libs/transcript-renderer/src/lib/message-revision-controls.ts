import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  activeMessageVariant,
  orderedMessageVariants,
  type ChatMessage,
  type MessageAlternateSlot,
  type MessageVariant,
} from '@rusty-view/chat-domain';

export type MessageRevisionActionKind =
  | 'previous_variant'
  | 'next_variant'
  | 'select_variant'
  | 'request_next_alternative'
  | 'delete_variant'
  | 'regenerate'
  | 'continue'
  | 'edit'
  | 'delete'
  | 'branch'
  | 'bookmark';

export interface MessageRevisionCapabilities {
  readonly regenerate?: boolean;
  readonly continue?: boolean;
  readonly edit?: boolean;
  readonly delete?: boolean;
  readonly deleteVariant?: boolean;
  readonly requestNextAlternative?: boolean;
  readonly branch?: boolean;
  readonly bookmark?: boolean;
}

export interface MessageRevisionAction {
  readonly kind: MessageRevisionActionKind;
  readonly message: ChatMessage;
  readonly slot?: MessageAlternateSlot;
  readonly variant?: MessageVariant;
}

@Component({
  selector: 'rv-message-revision-controls',
  templateUrl: './message-revision-controls.html',
  styleUrl: './message-revision-controls.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageRevisionControlsComponent {
  readonly message = input.required<ChatMessage>();
  readonly slot = input<MessageAlternateSlot | undefined>(undefined);
  readonly capabilities = input<MessageRevisionCapabilities>({});
  readonly action = output<MessageRevisionAction>();

  protected readonly variants = computed(() => {
    const slot = this.slot();
    return slot === undefined ? [] : orderedMessageVariants(slot);
  });

  protected readonly activeVariant = computed(() => {
    const slot = this.slot();
    return slot === undefined ? undefined : activeMessageVariant(slot);
  });

  protected readonly activeVariantIndex = computed(() => {
    const active = this.activeVariant();
    if (active === undefined) return -1;
    return this.variants().findIndex((variant) => variant.id === active.id);
  });

  protected readonly variantLabel = computed(() => {
    const variants = this.variants();
    if (variants.length <= 1) return '1/1';
    return `${this.activeVariantIndex() + 1}/${variants.length}`;
  });

  protected readonly canPrevious = computed(
    () => this.activeVariantIndex() > 0,
  );
  protected readonly canNext = computed(
    () =>
      this.activeVariantIndex() >= 0 &&
      this.activeVariantIndex() < this.variants().length - 1,
  );
  protected readonly canRequestNextAlternative = computed(
    () =>
      this.capabilities().requestNextAlternative === true &&
      this.variants().length > 0 &&
      this.activeVariantIndex() === this.variants().length - 1,
  );
  protected readonly nextButtonLabel = computed(() =>
    this.canNext() ? 'Next' : 'New',
  );
  protected readonly nextButtonTitle = computed(() =>
    this.canNext() ? 'Next variant' : 'Request next alternative',
  );
  protected readonly canDeleteVariant = computed(
    () =>
      this.capabilities().deleteVariant === true &&
      this.activeVariant()?.source === 'alternate',
  );

  protected emit(kind: MessageRevisionActionKind): void {
    this.emitAction(kind, this.activeVariant());
  }

  protected selectOffset(delta: -1 | 1): void {
    const next = this.variants()[this.activeVariantIndex() + delta];
    if (next === undefined) return;
    this.emitAction(delta === -1 ? 'previous_variant' : 'next_variant', next);
  }

  protected selectNextOrRequest(): void {
    if (this.canNext()) {
      this.selectOffset(1);
      return;
    }
    if (this.canRequestNextAlternative()) {
      this.emitAction('request_next_alternative', this.activeVariant());
    }
  }

  protected onVariantKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' && this.canPrevious()) {
      event.preventDefault();
      this.selectOffset(-1);
      return;
    }
    if (
      event.key === 'ArrowRight' &&
      (this.canNext() || this.canRequestNextAlternative())
    ) {
      event.preventDefault();
      this.selectNextOrRequest();
    }
  }

  protected selectActiveVariant(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const variant = this.variants().find((item) => item.id === target.value);
    if (variant === undefined) return;
    this.emitAction('select_variant', variant);
  }

  private emitAction(
    kind: MessageRevisionActionKind,
    variant: MessageVariant | undefined,
  ): void {
    const slot = this.slot();
    this.action.emit({
      kind,
      message: this.message(),
      ...(slot === undefined ? {} : { slot }),
      ...(variant === undefined ? {} : { variant }),
    });
  }
}
