import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import type { ExternalInteractionRecord } from '@rusty-view/protocol';
import { ExternalAgentStore } from '@rusty-view/chat-store';

@Component({
  selector: 'rv-external-interaction-card',
  templateUrl: './external-interaction-card.html',
  styleUrl: './external-interaction-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalInteractionCardComponent {
  readonly interaction = input.required<ExternalInteractionRecord>();
  protected readonly store = inject(ExternalAgentStore);
  protected readonly response = signal('{}');
  protected readonly error = signal<string | undefined>(undefined);

  protected resolvePreset(value: string): void {
    void this.resolve({ decision: value });
  }

  protected updateResponse(event: Event): void {
    this.response.set((event.target as HTMLTextAreaElement).value);
  }

  protected resolveJson(): void {
    try {
      void this.resolve(JSON.parse(this.response()) as unknown);
    } catch {
      this.error.set('Response must be valid JSON.');
    }
  }

  protected prompt(): string {
    return JSON.stringify(this.interaction().prompt, null, 2);
  }

  private async resolve(result: unknown): Promise<void> {
    this.error.set(undefined);
    try {
      await this.store.resolveInteraction(this.interaction(), result);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }
}
