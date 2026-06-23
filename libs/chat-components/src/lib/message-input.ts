import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';

/**
 * Presentational message input: text area with send button.
 *
 * Enter sends, Shift+Enter inserts a newline. Disabled while `disabled` is
 * true (e.g. during send or when no session is active). No service injection —
 * the parent controls send behavior via the `send` output.
 */
@Component({
  selector: 'rv-message-input',
  templateUrl: './message-input.html',
  styleUrl: './message-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageInputComponent {
  readonly disabled = input<boolean>(false);
  readonly placeholder = input<string>('Type a message…');
  readonly send = output<string>();

  protected readonly text = signal('');

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  protected submit(): void {
    const value = this.text().trim();
    if (value.length === 0 || this.disabled()) {
      return;
    }
    this.send.emit(value);
    this.text.set('');
  }
}
