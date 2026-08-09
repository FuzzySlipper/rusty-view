import {
  ChangeDetectionStrategy,
  Component,
  type WritableSignal,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  createExternalAgentRequestKey,
  ExternalAgentStore,
  ChatStore,
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
import { SessionOptionsComponent } from './session-options';

const CREATION_ATTEMPTS_STORAGE_KEY =
  'rusty-view:external-agent-creation-attempts:v1';
const MAX_PERSISTED_CREATION_ATTEMPTS = 20;
type ExternalAgentSessionCreateIntent = Omit<
  ExternalAgentSessionCreateWrite,
  'idempotencyKey'
>;
type SessionCreatorMode = 'crew' | 'codex';

@Component({
  selector: 'rv-external-agent-panel',
  imports: [SessionOptionsComponent],
  templateUrl: './external-agent-panel.html',
  styleUrl: './external-agent-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalAgentPanelComponent {
  readonly creatorRequest = input(0);
  readonly sessionSelected = output<void>();
  readonly crewSessionRestored = output<string>();
  readonly crewSessionCreated = output<string>();
  protected readonly store = inject(ExternalAgentStore);
  protected readonly chat = inject(ChatStore);
  protected readonly inventoryModes: readonly ExternalAgentInventoryMode[] = [
    'managed',
    'attention',
    'all',
    'archived',
  ];
  protected readonly query = signal('');
  protected readonly creating = signal(false);
  protected readonly creatorMode = signal<SessionCreatorMode>('crew');
  protected readonly runtimeId = signal('');
  protected readonly profileId = signal('');
  protected readonly cwd = signal('');
  protected readonly label = signal('');
  protected readonly taskProjectId = signal('');
  protected readonly taskId = signal('');
  protected readonly editingSessionKey = signal<string | undefined>(undefined);
  protected readonly attempted = signal(false);
  private readonly creationAttemptKeys = loadCreationAttemptKeys();
  private lastCreatorRequest = 0;

  protected readonly cwdValidationError = computed(() => {
    const cwd = this.cwd().trim();
    if (cwd === '') return 'Enter a working directory.';
    if (!cwd.startsWith('/')) return 'Working directory must be absolute.';
    return undefined;
  });

  protected readonly canOpenCreator = computed(
    () => this.store.creationProfiles().length > 0,
  );
  protected readonly canSubmit = computed(() => {
    if (this.profileId() === '') return false;
    if (this.creatorMode() === 'crew') {
      return (
        this.selectedCreationProfile()?.revision !== undefined &&
        !this.chat.crewSessionCreating()
      );
    }
    return this.runtimeId() !== '' && !this.store.creatingSession();
  });
  protected readonly creationPending = computed(() =>
    this.creatorMode() === 'crew'
      ? this.chat.crewSessionCreating()
      : this.store.creatingSession(),
  );
  protected readonly selectedCreationProfile = computed(() =>
    this.store
      .creationProfiles()
      .find((profile) => profile.profileId === this.profileId()),
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
    effect(() => {
      const request = this.creatorRequest();
      if (request <= this.lastCreatorRequest) return;
      if (this.store.creationProfiles().length === 0) return;
      this.lastCreatorRequest = request;
      this.openCreator();
    });
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

  protected recoveryStateLabel(
    session: ExternalAgentSession,
  ): string | undefined {
    if (session.relationship === 'lineage_predecessor') {
      return `Recovered predecessor · ${session.thread.turns.length === 0 ? 'empty' : 'history available'}${session.binding?.status === 'archived' ? ' · Crew archived' : ''}`;
    }
    if (session.relationship === 'lineage_successor') {
      return session.thread.turns.length === 0
        ? 'New replacement · empty · predecessor history preserved'
        : 'Replacement session · predecessor history preserved';
    }
    if (session.relationship === 'lineage_successor_recovery_required') {
      return 'New replacement · empty · native recovery required · predecessor history preserved';
    }
    if (session.relationship === 'recovery_required') {
      return 'Crew binding requires native-thread recovery';
    }
    if (session.relationship === 'unbound') {
      return 'Native-only history · no Crew binding';
    }
    return undefined;
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
    this.store.metadataError.set(undefined);
    this.store.metadataNotice.set(undefined);
    this.editingSessionKey.set(session.key);
  }

  protected closeOptions(): void {
    this.editingSessionKey.set(undefined);
    this.store.metadataError.set(undefined);
  }

  protected openCreator(): void {
    const runtime = this.store.readyRuntimes()[0];
    const profile = this.store.creationProfiles()[0];
    if (profile === undefined) return;
    this.creatorMode.set('crew');
    this.runtimeId.set(runtime?.runtimeId ?? '');
    this.profileId.set(profile.profileId);
    this.cwd.set(this.store.selectedThread()?.cwd ?? '');
    this.label.set('');
    this.taskProjectId.set('');
    this.taskId.set('');
    this.clearAttemptFeedback();
    this.chat.clearCrewSessionCreationFeedback();
    this.creating.set(true);
  }

  protected closeCreator(): void {
    if (this.creationPending()) return;
    this.creating.set(false);
  }

  protected setCreatorMode(mode: SessionCreatorMode): void {
    if (mode === this.creatorMode()) return;
    this.creatorMode.set(mode);
    this.clearAttemptFeedback();
    this.chat.clearCrewSessionCreationFeedback();
    if (mode === 'codex' && this.runtimeId() === '') {
      this.runtimeId.set(this.store.readyRuntimes()[0]?.runtimeId ?? '');
    }
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
    if (this.creatorMode() === 'crew') {
      const profile = this.selectedCreationProfile();
      if (profile?.revision === undefined) return;
      const intentKey = JSON.stringify({
        mode: 'crew',
        profileId: profile.profileId,
        profileRevision: profile.revision,
      });
      const result = await this.chat.createCrewSession(
        profile.profileId,
        profile.revision,
        this.idempotencyKeyFor(intentKey),
      );
      if (result === undefined) {
        await this.store.refreshCreationProfiles();
        return;
      }
      this.forgetAttempt(intentKey);
      const sessionId = crewCreationSessionId(result.creation.session);
      if (sessionId !== undefined) this.crewSessionCreated.emit(sessionId);
      this.creating.set(false);
      this.clearAttemptFeedback();
      return;
    }
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

function crewCreationSessionId(
  session: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = session['session_id'] ?? session['sessionId'];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
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
