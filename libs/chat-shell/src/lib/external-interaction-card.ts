import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  protected readonly answers = signal<Readonly<Record<string, string>>>({});
  protected readonly questions = computed(() =>
    requestUserInputQuestions(this.interaction().prompt),
  );

  protected selectAnswer(questionId: string, value: string): void {
    this.answers.update((answers) => ({ ...answers, [questionId]: value }));
  }

  protected updateAnswer(questionId: string, event: Event): void {
    this.selectAnswer(questionId, (event.target as HTMLInputElement).value);
  }

  protected resolveAnswers(): void {
    const questions = this.questions();
    const answers = this.answers();
    const missing = questions.find(
      (question) => (answers[question.id] ?? '').trim() === '',
    );
    if (missing !== undefined) {
      this.error.set(`Answer required: ${missing.question}`);
      return;
    }
    void this.resolve({
      answers: Object.fromEntries(
        questions.map((question) => [
          question.id,
          { answers: [answers[question.id]?.trim() ?? ''] },
        ]),
      ),
    });
  }

  protected resolveDecision(value: string): void {
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

interface RequestUserInputQuestion {
  readonly id: string;
  readonly header?: string;
  readonly question: string;
  readonly options: readonly {
    readonly label: string;
    readonly description?: string;
  }[];
}

function requestUserInputQuestions(
  prompt: unknown,
): readonly RequestUserInputQuestion[] {
  if (typeof prompt !== 'object' || prompt === null) return [];
  const questions = (prompt as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return [];
    const value = candidate as Record<string, unknown>;
    if (
      typeof value['id'] !== 'string' ||
      typeof value['question'] !== 'string'
    ) {
      return [];
    }
    const options = Array.isArray(value['options'])
      ? value['options'].flatMap((option) => {
          if (typeof option !== 'object' || option === null) return [];
          const item = option as Record<string, unknown>;
          return typeof item['label'] === 'string'
            ? [
                {
                  label: item['label'],
                  ...(typeof item['description'] === 'string'
                    ? { description: item['description'] }
                    : {}),
                },
              ]
            : [];
        })
      : [];
    return [
      {
        id: value['id'],
        question: value['question'],
        ...(typeof value['header'] === 'string'
          ? { header: value['header'] }
          : {}),
        options,
      },
    ];
  });
}
