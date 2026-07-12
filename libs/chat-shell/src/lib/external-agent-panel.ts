import {
  ChangeDetectionStrategy,
  Component,
  type WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ExternalAgentStore,
  type ExternalAgentSession,
} from '@rusty-view/chat-store';
import type { ExternalAgentSessionCreateWrite } from '@rusty-view/protocol';

const CREATION_ATTEMPTS_STORAGE_KEY =
  'rusty-view:external-agent-creation-attempts:v1';
const MAX_PERSISTED_CREATION_ATTEMPTS = 20;
type ExternalAgentSessionCreateIntent = Omit<
  ExternalAgentSessionCreateWrite,
  'idempotencyKey'
>;

@Component({
  selector: 'rv-external-agent-panel',
  templateUrl: './external-agent-panel.html',
  styleUrl: './external-agent-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalAgentPanelComponent {
  protected readonly store = inject(ExternalAgentStore);
  protected readonly query = signal('');
  protected readonly creating = signal(false);
  protected readonly runtimeId = signal('');
  protected readonly profileId = signal('');
  protected readonly cwd = signal('');
  protected readonly label = signal('');
  protected readonly taskProjectId = signal('');
  protected readonly taskId = signal('');
  protected readonly attempted = signal(false);
  private readonly creationAttemptKeys = loadCreationAttemptKeys();

  protected readonly canOpenCreator = computed(
    () =>
      this.store.readyRuntimes().length > 0 &&
      this.store.creationProfiles().length > 0,
  );
  protected readonly canSubmit = computed(
    () =>
      this.runtimeId() !== '' &&
      this.profileId() !== '' &&
      this.cwd().startsWith('/') &&
      !this.store.creatingSession(),
  );
  protected readonly sessions = computed(() => {
    const query = this.query().trim().toLowerCase();
    return query === ''
      ? this.store.sessions()
      : this.store.sessions().filter((session) =>
          [
            session.thread.name,
            session.thread.preview,
            session.thread.cwd,
            session.binding?.taskRef?.task_id,
          ].some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(query),
          ),
        );
  });

  constructor() {
    void this.store.refresh();
    void this.store.refreshCreationProfiles();
  }

  protected select(session: ExternalAgentSession): void {
    void this.store.selectSession(session);
  }

  protected updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected openCreator(): void {
    const runtime = this.store.readyRuntimes()[0];
    const profile = this.store.creationProfiles()[0];
    if (runtime === undefined || profile === undefined) return;
    this.runtimeId.set(runtime.runtimeId);
    this.profileId.set(profile.profileId);
    this.cwd.set(this.store.selectedThread()?.cwd ?? '');
    this.label.set('');
    this.taskProjectId.set('');
    this.taskId.set('');
    this.clearAttemptFeedback();
    this.creating.set(true);
  }

  protected closeCreator(): void {
    if (this.store.creatingSession()) return;
    this.creating.set(false);
  }

  protected updateDraft(target: WritableSignal<string>, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    if (target() === value) return;
    target.set(value);
    this.clearAttemptFeedback();
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) return;
    this.attempted.set(true);
    const intent = this.creationIntent();
    const intentKey = JSON.stringify(intent);
    const idempotencyKey = this.idempotencyKeyFor(intentKey);
    const result = await this.store.createSession({
      ...intent,
      idempotencyKey,
    });
    if (result === undefined) return;
    this.forgetAttempt(intentKey);
    this.creating.set(false);
    this.clearAttemptFeedback();
  }

  private creationIntent(): ExternalAgentSessionCreateIntent {
    const projectId = this.taskProjectId().trim();
    const taskId = this.taskId().trim();
    const label = this.label().trim();
    return {
      runtimeId: this.runtimeId(),
      profileId: this.profileId(),
      cwd: this.cwd().trim(),
      ...(label === '' ? {} : { label }),
      ...(projectId === '' && taskId === ''
        ? {}
        : {
            taskRef: {
              ...(projectId === '' ? {} : { project_id: projectId }),
              ...(taskId === '' ? {} : { task_id: taskId }),
            },
          }),
    };
  }

  private idempotencyKeyFor(intentKey: string): string {
    const existing = this.creationAttemptKeys[intentKey];
    if (existing !== undefined) return existing;
    const idempotencyKey = crypto.randomUUID();
    this.creationAttemptKeys[intentKey] = idempotencyKey;
    persistCreationAttemptKeys(this.creationAttemptKeys);
    return idempotencyKey;
  }

  private forgetAttempt(intentKey: string): void {
    delete this.creationAttemptKeys[intentKey];
    persistCreationAttemptKeys(this.creationAttemptKeys);
  }

  private clearAttemptFeedback(): void {
    this.attempted.set(false);
    this.store.creationError.set(undefined);
  }
}

function loadCreationAttemptKeys(): Record<string, string> {
  try {
    const serialized = sessionStorage.getItem(CREATION_ATTEMPTS_STORAGE_KEY);
    if (serialized === null) return {};
    const parsed: unknown = JSON.parse(serialized);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )
        .slice(-MAX_PERSISTED_CREATION_ATTEMPTS),
    );
  } catch {
    return {};
  }
}

function persistCreationAttemptKeys(attempts: Record<string, string>): void {
  try {
    const bounded = Object.fromEntries(
      Object.entries(attempts).slice(-MAX_PERSISTED_CREATION_ATTEMPTS),
    );
    sessionStorage.setItem(
      CREATION_ATTEMPTS_STORAGE_KEY,
      JSON.stringify(bounded),
    );
  } catch {
    // Session storage can be unavailable in embedded or privacy-restricted UIs.
  }
}
