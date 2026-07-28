import {
  ChangeDetectionStrategy,
  Component,
  type WritableSignal,
  computed,
  inject,
  output,
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

import {
  sessionStatusLabel,
  sessionStatusTone,
  type SessionStatusTone,
} from './session-status-label';

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
  readonly sessionSelected = output<void>();
  readonly crewSessionRestored = output<string>();
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
  protected readonly editingBindingId = signal<string | undefined>(undefined);
  protected readonly metadataLabel = signal('');
  protected readonly metadataProjectId = signal('');
  protected readonly metadataTaskId = signal('');
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
    this.sessionSelected.emit();
  }

  protected taskRefLabel(session: ExternalAgentSession): string {
    const taskRef = session.binding?.taskRef;
    if (taskRef === undefined || taskRef === null) return 'unmapped';
    const projectId = taskRef.project_id?.trim();
    const taskId = taskRef.task_id?.trim();
    if (projectId && taskId) return `${projectId} · #${taskId}`;
    if (projectId) return projectId;
    if (taskId) return `#${taskId}`;
    return 'unmapped';
  }

  protected sessionTitle(session: ExternalAgentSession): string {
    return (
      session.binding?.label ?? session.thread.name ?? session.thread.preview
    );
  }

  protected sessionStateLabel(session: ExternalAgentSession): string {
    return sessionStatusLabel(session.phase ?? session.thread.status);
  }

  protected sessionStateTone(session: ExternalAgentSession): SessionStatusTone {
    return sessionStatusTone(session.phase ?? session.thread.status);
  }

  protected bindingStateLabel(
    session: ExternalAgentSession,
  ): string | undefined {
    if (session.binding === undefined) return 'Native only';
    if (session.binding.status === 'active') return undefined;
    return `Crew ${sessionStatusLabel(session.binding.status)}`;
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

  protected crewRestoreDisabledReason(
    session: ExternalAgentSession,
  ): string | undefined {
    return (
      this.store.bindingRestoreUnavailableReason(session) ??
      this.lifecycleDisabledReason(session)
    );
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

  protected async restoreNativeHistory(
    session: ExternalAgentSession,
  ): Promise<void> {
    await this.store.unarchiveThread(session);
  }

  protected async restoreCrewSession(
    session: ExternalAgentSession,
  ): Promise<void> {
    const binding = session.binding;
    if (
      binding === undefined ||
      binding.sessionId == null ||
      binding.profileId == null
    ) {
      return;
    }
    if (
      !globalThis.confirm(
        `Restore this exact archived Crew session and binding?\n\nBinding: ${binding.bindingId}\nCrew session: ${binding.sessionId}\nProfile: ${binding.profileId}\nNative Codex thread: ${session.thread.threadId}\nWorking directory: ${session.thread.cwd}\n\nThis preserves the existing transcript and native thread. If identities drifted, Crew will reject the restore and reload current state.`,
      )
    ) {
      return;
    }
    if (await this.store.restoreBindingSession(session)) {
      this.crewSessionRestored.emit(binding.sessionId);
    }
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

  protected openOptions(session: ExternalAgentSession): void {
    const binding = session.binding;
    if (binding === undefined) return;
    this.metadataLabel.set(binding.label ?? '');
    this.metadataProjectId.set(binding.taskRef?.project_id ?? '');
    this.metadataTaskId.set(binding.taskRef?.task_id ?? '');
    this.store.metadataError.set(undefined);
    this.store.metadataNotice.set(undefined);
    this.editingBindingId.set(binding.bindingId);
  }

  protected closeOptions(): void {
    this.editingBindingId.set(undefined);
    this.store.metadataError.set(undefined);
  }

  protected metadataPending(session: ExternalAgentSession): boolean {
    const bindingId = session.binding?.bindingId;
    return (
      bindingId !== undefined &&
      this.store.metadataPendingBindingIds().has(bindingId)
    );
  }

  protected async saveOptions(
    session: ExternalAgentSession,
    event: Event,
  ): Promise<void> {
    event.preventDefault();
    const label = this.metadataLabel().trim();
    const projectId = this.metadataProjectId().trim();
    const taskId = this.metadataTaskId().trim();
    const saved = await this.store.updateSessionMetadata(session, {
      label: label === '' ? null : label,
      taskRef:
        projectId === '' && taskId === ''
          ? null
          : {
              ...(projectId === '' ? {} : { project_id: projectId }),
              ...(taskId === '' ? {} : { task_id: taskId }),
            },
    });
    if (saved) this.editingBindingId.set(undefined);
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
    this.store.metadataError.set(undefined);
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
