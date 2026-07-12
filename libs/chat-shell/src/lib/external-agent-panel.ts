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
  private readonly idempotencyKey = signal(crypto.randomUUID());

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
    this.resetAttempt();
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
    this.resetAttempt();
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) return;
    this.attempted.set(true);
    const projectId = this.taskProjectId().trim();
    const taskId = this.taskId().trim();
    const result = await this.store.createSession({
      idempotencyKey: this.idempotencyKey(),
      runtimeId: this.runtimeId(),
      profileId: this.profileId(),
      cwd: this.cwd().trim(),
      ...(this.label().trim() === '' ? {} : { label: this.label().trim() }),
      ...(projectId === '' && taskId === ''
        ? {}
        : {
            taskRef: {
              ...(projectId === '' ? {} : { project_id: projectId }),
              ...(taskId === '' ? {} : { task_id: taskId }),
            },
          }),
    });
    if (result === undefined) return;
    this.creating.set(false);
    this.resetAttempt();
  }

  private resetAttempt(): void {
    this.idempotencyKey.set(crypto.randomUUID());
    this.attempted.set(false);
    this.store.creationError.set(undefined);
  }
}
