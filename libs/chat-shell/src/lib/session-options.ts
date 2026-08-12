import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { sessionExecutionIsWorking } from '@rusty-view/chat-domain';
import {
  ChatStore,
  ExternalAgentStore,
  type ExternalAgentSession,
} from '@rusty-view/chat-store';
import type { ChatSessionSummary } from '@rusty-view/protocol';

@Component({
  selector: 'rv-session-options',
  templateUrl: './session-options.html',
  styleUrl: './session-options.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionOptionsComponent {
  readonly chatSession = input<ChatSessionSummary | undefined>(undefined);
  readonly externalSession = input<ExternalAgentSession | undefined>(undefined);
  readonly closed = output<void>();
  readonly archived = output<void>();

  protected readonly chat = inject(ChatStore);
  protected readonly external = inject(ExternalAgentStore);
  protected readonly metadataLabel = signal('');
  protected readonly metadataProjectId = signal('');
  protected readonly metadataTaskId = signal('');
  protected readonly actionError = signal<string | undefined>(undefined);
  protected readonly workspaceEditing = signal(false);
  protected readonly workspaceDraft = signal('');

  protected readonly binding = computed(() => this.externalSession()?.binding);
  protected readonly bindingProfileState = computed(() => {
    const session = this.externalSession();
    return session === undefined
      ? undefined
      : this.external.profileStateFor(session);
  });
  protected readonly lifecycleRecovery = computed(() => {
    const session = this.externalSession();
    return session === undefined
      ? undefined
      : this.external.lifecycleRecoveryFor(session);
  });
  protected readonly isCodex = computed(
    () => this.externalSession() !== undefined,
  );
  protected readonly directoryEntry = computed(() => {
    const sessionId = this.chatSession()?.session_id;
    return sessionId === undefined
      ? undefined
      : this.chat.sessionDirectoryEntry(sessionId);
  });
  protected readonly workspace = computed(
    () => this.directoryEntry()?.workspace ?? undefined,
  );

  constructor() {
    effect(() => {
      const binding = this.binding();
      this.chatSession();
      untracked(() => {
        this.metadataLabel.set(binding?.label ?? '');
        this.metadataProjectId.set(binding?.taskRef?.project_id ?? '');
        this.metadataTaskId.set(binding?.taskRef?.task_id ?? '');
        this.workspaceDraft.set(this.workspace()?.cwd ?? '');
        this.workspaceEditing.set(false);
        this.actionError.set(undefined);
        this.chat.clearSessionLifecycleError();
        this.chat.clearWorkspaceUpdateFeedback();
        this.external.metadataError.set(undefined);
      });
    });
  }

  protected updateDraft(target: typeof this.metadataLabel, event: Event): void {
    target.set((event.target as HTMLInputElement).value);
  }

  protected metadataPending(): boolean {
    const bindingId = this.binding()?.bindingId;
    return (
      bindingId !== undefined &&
      this.external.metadataPendingBindingIds().has(bindingId)
    );
  }

  protected workspaceValidationError(): string | undefined {
    const cwd = this.workspaceDraft().trim();
    if (cwd === '') return 'Enter a working directory.';
    if (!cwd.startsWith('/')) return 'Working directory must be absolute.';
    if (cwd === this.workspace()?.cwd) {
      return 'Enter a different working directory.';
    }
    return undefined;
  }

  protected workspaceDisabledReason(): string | undefined {
    const chatSession = this.chatSession();
    if (chatSession === undefined) return 'Session details are unavailable.';
    if (this.directoryEntry()?.runtimeKind !== 'direct_brain') {
      return 'Working-directory changes are available for native Crew brain sessions.';
    }
    if (this.workspace() === undefined) {
      return 'Crew did not expose authoritative workspace state for this session.';
    }
    if (this.chat.workspaceUpdatePendingIds().has(chatSession.session_id)) {
      return 'A working-directory change is already running.';
    }
    const execution = this.directoryEntry()?.execution;
    return sessionExecutionIsWorking(
      execution == null ? chatSession : { ...chatSession, execution },
    )
      ? 'Finish or interrupt the active turn first.'
      : undefined;
  }

  protected startWorkspaceEdit(): void {
    if (this.workspaceDisabledReason() !== undefined) return;
    this.workspaceDraft.set(this.workspace()?.cwd ?? '');
    this.chat.clearWorkspaceUpdateFeedback();
    this.workspaceEditing.set(true);
  }

  protected cancelWorkspaceEdit(): void {
    this.workspaceDraft.set(this.workspace()?.cwd ?? '');
    this.workspaceEditing.set(false);
  }

  protected async changeWorkspace(): Promise<void> {
    const chatSession = this.chatSession();
    const workspace = this.workspace();
    if (
      chatSession === undefined ||
      workspace === undefined ||
      this.workspaceDisabledReason() !== undefined ||
      this.workspaceValidationError() !== undefined
    ) {
      return;
    }
    if (
      await this.chat.switchCrewSessionWorkspace(
        chatSession.session_id,
        workspace.revision,
        this.workspaceDraft().trim(),
      )
    ) {
      this.workspaceEditing.set(false);
    }
  }

  protected archiveDisabledReason(): string | undefined {
    const externalSession = this.externalSession();
    if (externalSession !== undefined) {
      if (
        this.external
          .lifecyclePendingThreadIds()
          .has(externalSession.thread.threadId)
      ) {
        return 'A lifecycle request is already running.';
      }
      if (externalSession.controller?.driverState !== 'ready') {
        return 'The runtime controller is not ready.';
      }
      return undefined;
    }

    const chatSession = this.chatSession();
    if (chatSession === undefined) return 'Session details are unavailable.';
    if (this.chat.sessionLifecyclePendingIds().has(chatSession.session_id)) {
      return 'A lifecycle request is already running.';
    }
    return sessionExecutionIsWorking(chatSession)
      ? 'Finish or interrupt the active turn first.'
      : undefined;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const externalSession = this.externalSession();
    if (externalSession?.binding === undefined) return;
    const label = this.metadataLabel().trim();
    const projectId = this.metadataProjectId().trim();
    const taskId = this.metadataTaskId().trim();
    const saved = await this.external.updateSessionMetadata(externalSession, {
      label: label === '' ? null : label,
      taskRef:
        projectId === '' && taskId === ''
          ? null
          : {
              ...(projectId === '' ? {} : { project_id: projectId }),
              ...(taskId === '' ? {} : { task_id: taskId }),
            },
    });
    if (saved) this.closed.emit();
  }

  protected async archive(): Promise<void> {
    this.actionError.set(undefined);
    const externalSession = this.externalSession();
    if (externalSession !== undefined) {
      const warning = externalSession.binding
        ? 'This also archives the Crew binding for this session.'
        : 'This native Codex thread has no Crew binding.';
      if (
        !globalThis.confirm(
          `Archive native Codex thread ${externalSession.thread.threadId}?\n\n${warning}\n${externalSession.thread.cwd}`,
        )
      ) {
        return;
      }
      if (!(await this.external.archiveThread(externalSession))) return;
      try {
        await this.chat.reconcileSessionsAfterLifecycleMutation();
      } catch {
        this.actionError.set(
          'The session was archived, but the Agents list could not refresh. Use Refresh to reconcile it.',
        );
        return;
      }
      this.archived.emit();
      return;
    }

    const chatSession = this.chatSession();
    if (chatSession === undefined) return;
    if (
      !globalThis.confirm(
        `Archive Crew session ${chatSession.session_id}?\n\nThis archives exactly this session and preserves its transcript in History.`,
      )
    ) {
      return;
    }
    if (await this.chat.archiveSession(chatSession.session_id)) {
      this.archived.emit();
    }
  }

  protected externalLifecycleDisabledReason(): string | undefined {
    const session = this.externalSession();
    if (session === undefined) return 'Session details are unavailable.';
    if (session.binding === undefined) {
      return 'This native Codex thread has no Crew binding.';
    }
    if (
      this.external.lifecyclePendingThreadIds().has(session.thread.threadId)
    ) {
      return 'A lifecycle request is already running.';
    }
    return session.controller?.driverState !== 'ready'
      ? 'The runtime controller is not ready.'
      : undefined;
  }

  protected async startFreshSession(): Promise<void> {
    const session = this.externalSession();
    if (
      session === undefined ||
      this.externalLifecycleDisabledReason() !== undefined
    ) {
      return;
    }
    await this.external.restartSession(session);
  }

  protected async cancelActiveTurn(): Promise<void> {
    const session = this.externalSession();
    if (
      session === undefined ||
      this.externalLifecycleDisabledReason() !== undefined
    ) {
      return;
    }
    await this.external.interruptSession(session);
  }

  protected async refreshProfile(): Promise<void> {
    const session = this.externalSession();
    if (
      session === undefined ||
      this.externalLifecycleDisabledReason() !== undefined
    ) {
      return;
    }
    await this.external.refreshSessionProfile(session);
  }
}
