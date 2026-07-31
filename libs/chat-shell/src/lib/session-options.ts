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
  isActiveExternalSession,
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

  protected readonly binding = computed(() => this.externalSession()?.binding);
  protected readonly isCodex = computed(
    () => this.externalSession() !== undefined,
  );

  constructor() {
    effect(() => {
      const binding = this.binding();
      this.chatSession();
      untracked(() => {
        this.metadataLabel.set(binding?.label ?? '');
        this.metadataProjectId.set(binding?.taskRef?.project_id ?? '');
        this.metadataTaskId.set(binding?.taskRef?.task_id ?? '');
        this.actionError.set(undefined);
        this.chat.clearSessionLifecycleError();
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
      if (isActiveExternalSession(externalSession)) {
        return 'Finish or interrupt the active turn first.';
      }
      const hasPendingInteraction = this.external
        .interactions()
        .some(
          (interaction) =>
            interaction.runtimeId === externalSession.runtime.runtimeId &&
            interaction.nativeThreadId === externalSession.thread.threadId &&
            interaction.status === 'pending',
        );
      return hasPendingInteraction
        ? 'Resolve the pending interaction first.'
        : undefined;
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
}
