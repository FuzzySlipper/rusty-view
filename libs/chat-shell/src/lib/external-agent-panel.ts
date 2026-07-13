import {
  ChangeDetectionStrategy,
  Component,
  type WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  createExternalAgentRequestKey,
  ExternalAgentStore,
  isActiveExternalSession,
  type ExternalAgentInventoryMode,
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
  protected readonly inventoryModes: readonly ExternalAgentInventoryMode[] = [
    'managed',
    'attention',
    'all',
    'archived',
  ];
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

  protected readonly cwdValidationError = computed(() => {
    const cwd = this.cwd().trim();
    if (cwd === '') return 'Enter a working directory.';
    if (!cwd.startsWith('/')) return 'Working directory must be absolute.';
    return undefined;
  });

  protected readonly canOpenCreator = computed(
    () =>
      this.store.readyRuntimes().length > 0 &&
      this.store.creationProfiles().length > 0,
  );
  protected readonly canSubmit = computed(
    () =>
      this.runtimeId() !== '' &&
      this.profileId() !== '' &&
      !this.store.creatingSession(),
  );
  protected readonly sessions = computed(() => {
    const query = this.query().trim().toLowerCase();
    const filtered = this.store.inventorySessions();
    return query === ''
      ? filtered
      : filtered.filter((session) =>
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
  protected readonly inventoryCounts = computed(() =>
    summarizeExternalAgentSessions(this.store.sessions()),
  );

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

  protected async setInventoryMode(
    mode: ExternalAgentInventoryMode,
  ): Promise<void> {
    await this.store.setInventoryMode(mode);
  }

  protected lifecycleDisabledReason(
    session: ExternalAgentSession,
  ): string | undefined {
    if (this.store.lifecyclePendingThreadIds().has(session.thread.threadId)) {
      return 'A lifecycle request is already running.';
    }
    if (session.controller?.driverState !== 'ready') {
      return 'The runtime controller is not ready.';
    }
    if (isActiveExternalSession(session)) {
      return 'Finish or interrupt the active turn first.';
    }
    const hasPendingInteraction = this.store
      .interactions()
      .some(
        (interaction) =>
          interaction.runtimeId === session.runtime.runtimeId &&
          interaction.nativeThreadId === session.thread.threadId &&
          interaction.status === 'pending',
      );
    return hasPendingInteraction
      ? 'Resolve the pending interaction first.'
      : undefined;
  }

  protected async archive(session: ExternalAgentSession): Promise<void> {
    const warning = session.binding
      ? 'This also archives the associated Crew binding.'
      : 'This thread has no Crew binding.';
    if (
      !globalThis.confirm(
        `Archive native Codex thread ${session.thread.threadId}?\n\n${warning}\n${session.thread.cwd}`,
      )
    ) {
      return;
    }
    await this.store.archiveThread(session);
  }

  protected async restore(session: ExternalAgentSession): Promise<void> {
    await this.store.unarchiveThread(session);
  }

  protected async deletePermanently(
    session: ExternalAgentSession,
  ): Promise<void> {
    const confirmation = globalThis.prompt(
      `Permanently delete native Codex thread and archive related Crew bindings?\n\n${session.thread.cwd}\n\nType the thread ID to confirm:`,
    );
    if (confirmation !== session.thread.threadId) return;
    await this.store.deleteThread(session);
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
    if (this.cwdValidationError() !== undefined) return;
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
    const idempotencyKey = createExternalAgentRequestKey();
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

export function summarizeExternalAgentSessions(
  sessions: readonly ExternalAgentSession[],
): {
  readonly bound: number;
  readonly nativeOnly: number;
  readonly attention: number;
  readonly active: number;
} {
  return {
    bound: sessions.filter((session) => session.binding !== undefined).length,
    nativeOnly: sessions.filter((session) => session.binding === undefined)
      .length,
    attention: sessions.filter((session) => session.needsAttention).length,
    active: sessions.filter(isActiveExternalSession).length,
  };
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
