import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ChatStore, ExternalAgentStore } from '@rusty-view/chat-store';
import { ChatTheme } from '@rusty-view/chat-theme';
import type {
  ChatAttachment,
  ChatMessage,
  MessageBlock,
} from '@rusty-view/chat-domain';
import { ChatTransport } from '@rusty-view/transport';
import {
  ContextDiagnosticsComponent,
  MessageInputComponent,
  type MessageInputAttachmentSelection,
  type MessageInputAttachmentState,
  type MessageInputAttachmentStatus,
  type MessageInputAttachmentSubmission,
  type MessageInputCommandDescriptor,
  StreamStatusComponent,
  TooltipDirective,
  matchesHotkey,
} from '@rusty-view/chat-components';
import type { StreamStatusKind } from '@rusty-view/chat-components';
import {
  MESSAGE_BLOCK_DETAIL_LOADER,
  TOOL_CALL_DEBUG_DETAIL_LOADER,
  ATTACHMENT_CONTENT_LOADER,
  TranscriptViewportComponent,
  type MessageBlockDetail,
  type MessageRevisionAction,
  type MessageRevisionCapabilities,
  type TranscriptScrollWriteTrace,
} from '@rusty-view/transcript-renderer';
import { EventInspectorComponent } from './event-inspector';
import { ProfilePanelComponent } from './profile-panel';
import { ExternalAgentPanelComponent } from './external-agent-panel';
import { ExternalInteractionCardComponent } from './external-interaction-card';
import { TopMenuComponent } from './top-menu';
import { HotkeySettingsService } from './hotkey-settings';
import {
  CHAT_SLASH_COMMANDS,
  type ChatPluginCommandResult,
} from './plugin-api';
import {
  executeSlashCommand,
  findSlashCommand,
  pluginCommandDescriptor,
} from './slash-commands/slash-command-runtime';
import { externalCommandComposerDescriptors } from './external-command-composer';
import { formatNativeReasoningEffort } from './native-reasoning-effort';
import {
  attachmentMessageIdentity,
  type AttachmentMessageIdentity,
} from './attachment-message-identity';

interface ComposerAttachmentUpload {
  readonly selection: MessageInputAttachmentSelection;
  readonly sessionId: string;
  readonly status: MessageInputAttachmentStatus;
  readonly attachmentId?: string;
  readonly error?: string;
}

/**
 * Debug chat shell — the composition layer that wires everything together.
 *
 * Layout: header with stream status → profile sidebar → central transcript +
 * message input → event inspector panel. Dense, workbench-style, and
 * product-agnostic.
 *
 * Container component: injects ChatStore. All presentational components below
 * receive data through inputs and emit events through outputs.
 */
@Component({
  selector: 'rv-debug-shell',
  imports: [
    ProfilePanelComponent,
    ExternalAgentPanelComponent,
    ExternalInteractionCardComponent,
    TranscriptViewportComponent,
    MessageInputComponent,
    StreamStatusComponent,
    EventInspectorComponent,
    ContextDiagnosticsComponent,
    TopMenuComponent,
    TooltipDirective,
  ],
  templateUrl: './debug-shell.html',
  styleUrl: './debug-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: ATTACHMENT_CONTENT_LOADER,
      useFactory:
        (transport: ChatTransport) =>
        async (attachment: ChatAttachment, signal: AbortSignal) => {
          if (attachment.url === undefined) {
            throw new Error('Attachment content reference is unavailable.');
          }
          return transport.readAttachmentContent(attachment.url, signal);
        },
      deps: [ChatTransport],
    },
    {
      provide: TOOL_CALL_DEBUG_DETAIL_LOADER,
      useFactory: (store: ChatStore) =>
        store.loadToolCallDebugDetail.bind(store),
      deps: [ChatStore],
    },
    {
      provide: MESSAGE_BLOCK_DETAIL_LOADER,
      useFactory:
        (store: ExternalAgentStore) => async (block: MessageBlock) => {
          const runtimeId = metadataString(block, 'externalRuntimeId');
          const detailId = metadataString(block, 'boundedDetailRef');
          if (runtimeId === undefined || detailId === undefined) {
            throw new Error('Bounded detail reference is incomplete.');
          }
          const detailIds = metadataStrings(block, 'boundedDetailRefs') ?? [
            detailId,
          ];
          let fallback: MessageBlockDetail | undefined;
          let lastError: unknown;
          for (const candidateId of [...detailIds].reverse()) {
            try {
              const detail = await store.readRawDetail(runtimeId, candidateId);
              const candidate = {
                content: formatExternalDetail(detail.json),
                truncated: detail.truncated,
                redactedKeys: detail.redactedKeys,
              };
              fallback ??= candidate;
              if (candidate.content.trim().length > 0) return candidate;
            } catch (error) {
              lastError = error;
            }
          }
          if (fallback !== undefined) return fallback;
          throw lastError ?? new Error('Bounded detail was not found.');
        },
      deps: [ExternalAgentStore],
    },
  ],
})
export class DebugShellComponent {
  protected readonly store = inject(ChatStore);
  protected readonly external = inject(ExternalAgentStore);
  protected readonly hotkeys = inject(HotkeySettingsService);
  protected readonly theme = inject(ChatTheme);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transport = inject(ChatTransport);
  private readonly slashCommands =
    inject(CHAT_SLASH_COMMANDS, { optional: true }) ?? [];
  private readonly transcriptViewport = viewChild(TranscriptViewportComponent);
  private readonly messageInput = viewChild(MessageInputComponent);
  private readonly composerAttachments = signal<
    readonly ComposerAttachmentUpload[]
  >([]);
  private readonly composerAttachmentError = signal<string | undefined>(
    undefined,
  );
  private composerSessionId: string | null = null;
  private attachmentMessageIdentity: AttachmentMessageIdentity | undefined;

  protected readonly showInspector = computed(
    () => this.theme.settings().showInspector,
  );
  protected readonly showProfiles = computed(
    () => this.theme.settings().showProfiles,
  );
  protected readonly showSessionStatusBar = computed(
    () => this.theme.settings().showSessionStatusBar,
  );
  protected readonly showTranscriptSearch = signal(false);
  protected readonly sidebarMode = signal<'profiles' | 'agents'>('profiles');
  protected readonly mobileSessionsOpen = signal(false);
  /** Which inspector tab is shown: the raw event log or context diagnostics. */
  protected readonly inspectorTab = signal<'events' | 'context'>('events');
  protected readonly selectedEventId = signal<string | undefined>(undefined);
  protected readonly contextLoading = signal(false);
  protected readonly pluginCommandPending = signal(false);
  protected readonly pluginCommandError = signal<string | undefined>(undefined);
  protected readonly navigationError = signal<string | undefined>(undefined);
  private readonly runtimeSelectionPending = signal(false);
  protected readonly creatorRequestRevision = signal(0);
  private navigationRevision = 0;
  private automaticallyRoutedSessionId: string | undefined;

  protected readonly connectionStatus = computed<StreamStatusKind>(() => {
    const state = this.store.connectionState();
    return state.status as StreamStatusKind;
  });

  protected readonly cursorLabel = computed(() => {
    const cursor = this.store.lastCursor();
    return cursor ?? '—';
  });

  protected readonly externalSelected = computed(
    () => this.external.selectedThreadId() !== undefined,
  );
  private readonly runtimeRoutingUnresolved = computed(() => {
    if (this.externalSelected()) return false;
    const sessionId = this.store.activeSessionId();
    if (sessionId === null) return false;
    if (this.store.sessionDirectoryLoading()) return true;
    return this.requiresExternalBindingResolution(sessionId);
  });
  /** Disable the message input when routing, streaming, or submitting. */
  protected readonly inputDisabled = computed(
    () =>
      this.runtimeSelectionPending() ||
      this.runtimeRoutingUnresolved() ||
      (this.external.selectedThreadId() === undefined &&
        (this.store.sessionLoading() ||
          this.store.isGenerating() ||
          this.store.isSubmitting())) ||
      (this.external.selectedThreadId() !== undefined &&
        this.external.loading()) ||
      this.external.pending() ||
      this.pluginCommandPending() ||
      this.composerAttachments().some((attachment) =>
        ['uploading', 'sending', 'removing'].includes(attachment.status),
      ),
  );
  protected readonly attachmentsEnabled = computed(
    () => this.unifiedSelectedSessionId() !== null,
  );
  protected readonly attachmentScopes = [
    {
      id: 'chat-images',
      label: 'Chat images',
      accept: 'image/png,image/jpeg,image/webp',
      multiple: true,
    },
  ] as const;
  protected readonly composerAttachmentStates = computed<
    readonly MessageInputAttachmentState[]
  >(() =>
    this.composerAttachments().map((attachment) => ({
      localAttachmentId: attachment.selection.attachment.id,
      status: attachment.status,
      ...(attachment.error === undefined ? {} : { error: attachment.error }),
    })),
  );
  protected readonly unifiedSelectedSessionId = computed(() =>
    this.externalSelected()
      ? (this.external.selectedBinding()?.sessionId ?? null)
      : this.store.activeSessionId(),
  );
  protected readonly displayedMessages = computed(() =>
    this.externalSelected() ? this.external.messages() : this.store.messages(),
  );
  protected readonly transcriptLoading = computed(() =>
    this.externalSelected()
      ? this.external.loading()
      : this.store.sessionLoading(),
  );
  protected readonly transcriptKey = computed(() => {
    if (this.externalSelected()) {
      const key = this.external.selectedSessionKey();
      return key === undefined ? undefined : `external:${key}`;
    }
    const sessionId = this.store.activeSessionId();
    return sessionId === null ? undefined : `native:${sessionId}`;
  });
  protected readonly hasConversation = computed(
    () => this.externalSelected() || this.store.activeSessionId() !== undefined,
  );
  protected readonly externalAttention = computed(() =>
    this.external
      .sessions()
      .some((session) => session.needsAttention || session.unread),
  );

  protected readonly sessionActivity = computed<
    'working' | 'waiting' | 'idle' | 'error' | 'loading'
  >(() => {
    if (this.externalSelected()) {
      if (this.external.loading()) return 'loading';
      const phase = this.external.turnPhase();
      if (phase === 'waiting_interaction') return 'waiting';
      if (
        this.external.pending() ||
        this.external.activeTurnId() !== undefined ||
        phase === 'accepted' ||
        phase === 'starting' ||
        phase === 'active'
      ) {
        return 'working';
      }
      if (phase === 'failed' || phase === 'outcome_unknown') return 'error';
      if (
        phase === undefined &&
        this.external.selectedThread()?.status === 'active'
      ) {
        return 'working';
      }
      return 'idle';
    }
    if (this.store.sessionLoading()) return 'loading';
    const execution = this.store.activeSessionExecution();
    if (execution?.phase === 'waiting' || execution?.phase === 'paused') {
      return 'waiting';
    }
    if (
      execution?.lastOutcome === 'failed' ||
      execution?.lastOutcome === 'interrupted'
    ) {
      return 'error';
    }
    if (this.store.isGenerating() || this.store.isSubmitting())
      return 'working';
    if (this.store.activeSession()?.status === 'blocked') return 'waiting';
    if (this.store.connectionState().status === 'error') return 'error';
    return 'idle';
  });

  protected readonly sessionActivityLabel = computed(() => {
    switch (this.sessionActivity()) {
      case 'working':
        return 'Working';
      case 'waiting':
        return 'Waiting';
      case 'error':
        return 'Error';
      case 'loading':
        return 'Loading';
      case 'idle':
        return 'Idle';
    }
  });

  protected readonly selectedModel = computed(() =>
    this.externalSelected()
      ? (this.external.selectedThread()?.effectiveModel ?? 'Unavailable')
      : (this.store.contextUsage()?.provider.model_id ?? 'Unavailable'),
  );

  protected readonly nativeReasoningEffort = computed(() =>
    formatNativeReasoningEffort(this.store.contextUsage()?.provider),
  );

  protected readonly inputCommands = computed<
    readonly MessageInputCommandDescriptor[]
  >(() =>
    this.externalSelected()
      ? externalCommandComposerDescriptors(this.external.commandCatalog())
      : [
          ...this.store.commands(),
          ...this.slashCommands.map((command) =>
            pluginCommandDescriptor(command),
          ),
        ],
  );
  protected readonly inputSubmissionHistory = computed(() => {
    const commands = this.externalSelected()
      ? this.external.commandHistory()
      : this.store.commandHistory();
    return submissionHistory(this.displayedMessages(), commands);
  });
  protected readonly composerError = computed(
    () =>
      this.composerAttachmentError() ??
      (this.externalSelected()
        ? this.external.commandError()
        : this.pluginCommandError()),
  );

  protected readonly isViewingHistorical = computed(() =>
    this.store.isViewingHistorical(),
  );

  protected readonly viewingSessionId = computed(() =>
    this.store.viewingHistoricalSessionId(),
  );
  protected readonly revisionCapabilities: MessageRevisionCapabilities = {
    deleteVariant: true,
  };

  constructor() {
    this.installTestSnapshotApi();
    effect(() => {
      const sessionId = this.unifiedSelectedSessionId();
      if (sessionId === this.composerSessionId) return;
      this.composerSessionId = sessionId;
      untracked(() => this.clearComposerAttachments());
    });
    effect(() => {
      const sessionId = this.store.activeSessionId();
      const runtimeKind =
        sessionId === null
          ? undefined
          : this.store.sessionDirectoryEntry(sessionId)?.runtimeKind;
      const directoryLoading = this.store.sessionDirectoryLoading();
      const selectedExternalSessionId =
        this.external.selectedBinding()?.sessionId;

      if (typeof selectedExternalSessionId === 'string') {
        untracked(() => {
          this.store.rememberProfileSessionSelection(selectedExternalSessionId);
        });
      }

      if (
        sessionId === null ||
        directoryLoading ||
        !this.requiresExternalBindingResolution(sessionId, runtimeKind) ||
        selectedExternalSessionId === sessionId ||
        this.automaticallyRoutedSessionId === sessionId
      ) {
        return;
      }

      this.automaticallyRoutedSessionId = sessionId;
      untracked(() => {
        void this.selectUnifiedSession(sessionId);
      });
    });
  }

  @HostListener('document:keydown', ['$event'])
  protected onGlobalHotkey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.mobileSessionsOpen()) {
      event.preventDefault();
      this.mobileSessionsOpen.set(false);
      return;
    }
    if (matchesHotkey(event, this.hotkeys.binding('nextSession'))) {
      event.preventDefault();
      this.cycleSession(1);
      return;
    }
    if (matchesHotkey(event, this.hotkeys.binding('previousSession'))) {
      event.preventDefault();
      this.cycleSession(-1);
    }
  }

  protected onUnifiedSessionSelected(sessionId: string): void {
    this.closeMobileSessions();
    void this.selectUnifiedSession(sessionId);
  }

  protected onNewSessionRequested(): void {
    this.sidebarMode.set('agents');
    // The Codex-management panel is created by this mode change. Deliver the
    // open request in the next microtask so its signal input observes a real
    // transition even when this is the first visit to that panel.
    queueMicrotask(() => {
      this.creatorRequestRevision.update((revision) => revision + 1);
    });
  }

  protected onExternalSessionSelected(): void {
    this.navigationRevision += 1;
    this.runtimeSelectionPending.set(false);
    this.navigationError.set(undefined);
    this.closeMobileSessions();
  }

  protected onCrewSessionCreated(sessionId: string): void {
    this.navigationRevision += 1;
    this.runtimeSelectionPending.set(false);
    this.external.clearSelection();
    this.store.rememberProfileSessionSelection(sessionId);
    this.sidebarMode.set('profiles');
    this.navigationError.set(undefined);
    this.closeMobileSessions();
  }

  protected async onExternalCrewSessionRestored(
    sessionId: string,
  ): Promise<void> {
    this.navigationRevision += 1;
    this.runtimeSelectionPending.set(false);
    this.navigationError.set(undefined);
    await this.store.refreshSessions();
    await this.store.waitForSessionDirectory();
    this.store.rememberProfileSessionSelection(sessionId);
    this.closeMobileSessions();
  }

  private cycleSession(direction: 1 | -1): void {
    if (this.sidebarMode() === 'agents') {
      const sessions = this.external
        .inventorySessions()
        .filter((session) => canCycleExternalThread(session.thread.status));
      const target = cyclicTarget(
        sessions,
        this.external.selectedSessionKey(),
        (session) => session.key,
        direction,
      );
      if (target !== undefined) void this.external.selectSession(target);
      return;
    }

    const sessions = this.store
      .profiles()
      .flatMap((profile) => profile.liveSessions);
    const target = cyclicTarget(
      sessions,
      this.unifiedSelectedSessionId(),
      (session) => session.session_id,
      direction,
    );
    if (target !== undefined) void this.selectUnifiedSession(target.session_id);
  }

  private async selectUnifiedSession(sessionId: string): Promise<void> {
    const revision = ++this.navigationRevision;
    this.runtimeSelectionPending.set(true);
    this.navigationError.set(undefined);
    try {
      if (this.store.sessionDirectoryLoading()) {
        await this.store.waitForSessionDirectory();
      }
      if (revision !== this.navigationRevision) return;

      const directory = this.store.sessionDirectoryEntry(sessionId);
      if (
        this.requiresExternalBindingResolution(
          sessionId,
          directory?.runtimeKind,
        )
      ) {
        const selected = await this.external.selectCoordinationSession(
          sessionId,
          directory?.bindingId ?? undefined,
        );
        if (revision !== this.navigationRevision) return;
        if (!selected) {
          this.navigationError.set(
            this.external.error() ??
              `Codex session ${sessionId} could not be opened.`,
          );
          return;
        }
        this.store.rememberProfileSessionSelection(sessionId);
        return;
      }

      this.automaticallyRoutedSessionId = undefined;
      this.external.clearSelection();
      await this.store.selectProfileSession(sessionId);
      if (revision === this.navigationRevision) {
        this.navigationError.set(undefined);
      }
    } finally {
      if (revision === this.navigationRevision) {
        this.runtimeSelectionPending.set(false);
      }
    }
  }

  /**
   * Runtime directory data is authoritative. The stable external-agent id
   * prefix is only a fail-closed hint while that optional directory is absent;
   * ExternalAgentStore still requires a real binding before it can select.
   */
  private requiresExternalBindingResolution(
    sessionId: string,
    runtimeKind = this.store.sessionDirectoryEntry(sessionId)?.runtimeKind,
  ): boolean {
    if (runtimeKind === 'codex_app_server') return true;
    if (runtimeKind !== undefined) return false;
    return (
      this.store
        .sessions()
        .find((session) => session.session_id === sessionId)
        ?.agent_id.startsWith('external-agent-') === true
    );
  }

  protected onSendMessage(text: string): void {
    if (this.runtimeSelectionPending() || this.runtimeRoutingUnresolved()) {
      this.navigationError.set(
        'Session routing is still resolving. Send again when the session is ready.',
      );
      return;
    }
    if (this.externalSelected()) {
      if (text.trimStart().startsWith('/')) {
        void this.external.executeCommand(text);
      } else {
        void this.external.send(text);
      }
      return;
    }
    if (text.startsWith('/') && this.hasPluginCommand(text)) {
      void this.runPluginCommand(text);
      return;
    }

    void this.store.submit(text);
  }

  protected onAttachmentsSelected(
    selections: readonly MessageInputAttachmentSelection[],
  ): void {
    const sessionId = this.unifiedSelectedSessionId();
    if (sessionId === null) return;
    this.composerAttachmentError.set(undefined);
    this.composerAttachments.update((attachments) => [
      ...attachments,
      ...selections.map((selection) => ({
        selection,
        sessionId,
        status: 'uploading' as const,
      })),
    ]);
    for (const selection of selections) {
      void this.uploadComposerAttachment(selection, sessionId);
    }
  }

  protected openAttachmentPicker(): void {
    this.messageInput()?.openAttachmentPicker();
  }

  protected onAttachmentRetry(
    selection: MessageInputAttachmentSelection,
  ): void {
    const attachment = this.composerAttachments().find(
      (candidate) =>
        candidate.selection.attachment.id === selection.attachment.id,
    );
    if (attachment === undefined) return;
    void this.uploadComposerAttachment(selection, attachment.sessionId);
  }

  protected onAttachmentRemoved(
    selection: MessageInputAttachmentSelection,
  ): void {
    const attachment = this.composerAttachments().find(
      (candidate) =>
        candidate.selection.attachment.id === selection.attachment.id,
    );
    this.composerAttachments.update((attachments) =>
      attachments.filter(
        (candidate) =>
          candidate.selection.attachment.id !== selection.attachment.id,
      ),
    );
    if (attachment?.attachmentId !== undefined) {
      void this.removeUploadedAttachment(attachment);
    }
  }

  protected async onSendWithAttachments(
    submission: MessageInputAttachmentSubmission,
  ): Promise<void> {
    const uploads = submission.attachments
      .map((selection) =>
        this.composerAttachments().find(
          (candidate) =>
            candidate.selection.attachment.id === selection.attachment.id,
        ),
      )
      .filter(
        (attachment): attachment is ComposerAttachmentUpload =>
          attachment !== undefined,
      );
    if (
      uploads.length !== submission.attachments.length ||
      uploads.some(
        (attachment) =>
          attachment.status !== 'uploaded' ||
          attachment.attachmentId === undefined,
      )
    ) {
      this.composerAttachmentError.set(
        'Every image must finish uploading before send. Retry or remove failed images.',
      );
      return;
    }
    this.composerAttachmentError.set(undefined);
    this.updateComposerAttachmentStatus(
      uploads.map((upload) => upload.selection.attachment.id),
      'sending',
    );
    this.attachmentMessageIdentity = attachmentMessageIdentity(
      this.attachmentMessageIdentity,
      submission.text,
      uploads.map((upload) => upload.attachmentId as string),
      newAttachmentMessageIdempotencyKey,
    );
    const attachmentIds = uploads.map(
      (upload) => upload.attachmentId as string,
    );
    const accepted = this.externalSelected()
      ? await this.external.sendWithAttachments(
          submission.text,
          attachmentIds,
          this.attachmentMessageIdentity.idempotencyKey,
        )
      : await this.store.sendMessageWithAttachments(
          submission.text,
          attachmentIds,
          this.attachmentMessageIdentity.idempotencyKey,
        );
    if (!accepted) {
      this.updateComposerAttachmentStatus(
        uploads.map((upload) => upload.selection.attachment.id),
        'error',
        'Message send failed. The uploaded image is retained for retry.',
      );
      this.composerAttachmentError.set(
        'Message send failed. Retry with the same uploaded images.',
      );
      return;
    }
    const completedIds = new Set(
      uploads.map((upload) => upload.selection.attachment.id),
    );
    this.composerAttachments.update((attachments) =>
      attachments.filter(
        (attachment) => !completedIds.has(attachment.selection.attachment.id),
      ),
    );
    this.attachmentMessageIdentity = undefined;
    this.messageInput()?.completeAttachmentSubmission();
  }

  private async uploadComposerAttachment(
    selection: MessageInputAttachmentSelection,
    sessionId: string,
  ): Promise<void> {
    this.updateComposerAttachmentStatus([selection.attachment.id], 'uploading');
    try {
      const result = await this.transport.uploadAttachment(
        sessionId,
        selection.file,
        selection.file.name || 'clipboard-image',
        `rusty-view:${selection.attachment.id}`,
      );
      const current = this.composerAttachments().find(
        (attachment) =>
          attachment.selection.attachment.id === selection.attachment.id,
      );
      if (current === undefined || current.sessionId !== sessionId) {
        await this.transport.removeAttachment(
          sessionId,
          result.attachment.attachment_id,
        );
        return;
      }
      this.composerAttachments.update((attachments) =>
        attachments.map((attachment) =>
          attachment.selection.attachment.id === selection.attachment.id
            ? uploadedComposerAttachment(
                attachment,
                result.attachment.attachment_id,
              )
            : attachment,
        ),
      );
    } catch (error) {
      this.updateComposerAttachmentStatus(
        [selection.attachment.id],
        'error',
        composerErrorMessage(error),
      );
    }
  }

  private async removeUploadedAttachment(
    attachment: ComposerAttachmentUpload,
  ): Promise<void> {
    try {
      await this.transport.removeAttachment(
        attachment.sessionId,
        attachment.attachmentId as string,
      );
    } catch (error) {
      this.composerAttachmentError.set(
        `Image cleanup failed: ${composerErrorMessage(error)}`,
      );
    }
  }

  private updateComposerAttachmentStatus(
    localIds: readonly string[],
    status: MessageInputAttachmentStatus,
    error?: string,
  ): void {
    const ids = new Set(localIds);
    this.composerAttachments.update((attachments) =>
      attachments.map((attachment) =>
        ids.has(attachment.selection.attachment.id)
          ? composerAttachmentWithStatus(attachment, status, error)
          : attachment,
      ),
    );
  }

  private clearComposerAttachments(): void {
    const attachments = this.composerAttachments();
    this.composerAttachments.set([]);
    this.composerAttachmentError.set(undefined);
    this.attachmentMessageIdentity = undefined;
    for (const attachment of attachments) {
      if (attachment.attachmentId !== undefined) {
        void this.removeUploadedAttachment(attachment);
      }
    }
    this.messageInput()?.completeAttachmentSubmission();
  }

  protected onReconnect(): void {
    void this.store.reconnect();
  }

  protected toggleInspector(): void {
    void this.theme.update({ showInspector: !this.showInspector() });
  }

  protected toggleProfiles(): void {
    void this.theme.update({ showProfiles: !this.showProfiles() });
  }

  protected toggleMobileSessions(): void {
    this.mobileSessionsOpen.update((open) => !open);
  }

  protected closeMobileSessions(): void {
    this.mobileSessionsOpen.set(false);
  }

  protected showSidebar(mode: 'profiles' | 'agents'): void {
    this.sidebarMode.set(mode);
  }

  protected setExternalComposerMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (
      value === 'auto' ||
      value === 'steer' ||
      value === 'queue' ||
      value === 'plan'
    ) {
      this.external.composerMode.set(value);
    }
  }

  protected toggleTranscriptSearch(): void {
    this.showTranscriptSearch.update((v) => !v);
  }

  protected selectEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
  }

  protected showInspectorTab(tab: 'events' | 'context'): void {
    this.inspectorTab.set(tab);
  }

  protected loadExternalEventHistory(): void {
    void this.external.loadSelectedEventHistory();
  }

  protected async onRefreshContext(): Promise<void> {
    this.contextLoading.set(true);
    try {
      await this.store.loadContextUsage();
    } finally {
      this.contextLoading.set(false);
    }
  }

  protected onReturnToActive(): void {
    void this.store.returnToActiveSession();
  }

  protected onActiveBranchSelected(branchId: string): void {
    void this.store.selectActiveConversationBranch(branchId);
  }

  protected onRevisionRequested(action: MessageRevisionAction): void {
    const slot = action.slot;
    if (slot === undefined) return;
    if (
      action.kind === 'select_variant' ||
      action.kind === 'previous_variant' ||
      action.kind === 'next_variant'
    ) {
      const variant = action.variant;
      if (variant === undefined) return;
      const activeVariantId =
        variant.source === 'primary' ? undefined : variant.id;
      void this.store.selectActiveMessageVariant(slot.id, activeVariantId);
      return;
    }
    if (action.kind === 'delete_variant' && action.variant !== undefined) {
      void this.store.deleteMessageVariant(slot.id, action.variant.id);
    }
  }

  private hasPluginCommand(text: string): boolean {
    const name = text.trim().split(/\s+/, 1)[0]?.slice(1);
    return (
      name !== undefined &&
      findSlashCommand(this.slashCommands, name) !== undefined
    );
  }

  private async runPluginCommand(text: string): Promise<void> {
    this.pluginCommandPending.set(true);
    this.pluginCommandError.set(undefined);

    try {
      const controller = new AbortController();
      const result = await executeSlashCommand(text, this.slashCommands, {
        sessionId: this.store.activeSessionId() ?? undefined,
        messageId: undefined,
        selectedText: undefined,
        piped: undefined,
        signal: controller.signal,
        confirm: async (policy) =>
          confirmCommand(policy.message ?? policy.title),
      });

      this.handlePluginCommandResult(text, result);
    } finally {
      this.pluginCommandPending.set(false);
    }
  }

  private handlePluginCommandResult(
    command: string,
    result: ChatPluginCommandResult,
  ): void {
    switch (result.type) {
      case 'silent':
      case 'value':
        this.store.recordCommand(command);
        return;
      case 'message':
        this.store.recordCommand(command);
        if (result.role === 'user') {
          void this.store.sendMessage(result.content);
        }
        return;
      case 'abort':
        return;
      case 'error':
        this.pluginCommandError.set(result.message);
        return;
    }
  }

  private installTestSnapshotApi(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const api: RustyViewTestApi = {
      getActiveSessionId: () => this.store.activeSessionId(),
      getConnectionStatus: () => this.store.connectionState().status,
      getIsGenerating: () => this.store.isGenerating(),
      getIsStreaming: () => this.store.isStreaming(),
      getStreamingCharCount: () => this.store.streamingCharCount(),
      getLastCursor: () => this.store.lastCursor(),
      getMessageCount: () => this.store.messages().length,
      getDisplayedMessageCount: () => this.displayedMessages().length,
      getDisplayedMessages: () =>
        this.displayedMessages().map((message) => ({
          id: message.id,
          role: message.author.role,
          status: message.status,
          blockKinds: message.blocks.map((block) => block.kind),
          text: message.blocks.map((block) => block.content).join('\n'),
        })),
      getRawEventCount: () => this.store.rawEvents().length,
      getBackendBaseUrl: () => this.store.backendBaseUrl(),
      getMessages: () =>
        this.store.messages().map((message) => ({
          id: message.id,
          role: message.author.role,
          status: message.status,
          blockKinds: message.blocks.map((block) => block.kind),
          text: message.blocks.map((block) => block.content).join('\n'),
        })),
      scrollToMessageId: (messageId: string) => {
        this.transcriptViewport()?.scrollToMessageId(messageId);
      },
      scrollTranscriptToLatest: () => {
        this.transcriptViewport()?.scrollToBottom();
      },
      setTranscriptScrollDiagnosticsEnabled: (enabled: boolean) => {
        this.transcriptViewport()?.setScrollDiagnosticsEnabled(enabled);
      },
      clearTranscriptScrollWriteTrace: () => {
        this.transcriptViewport()?.clearScrollWriteTrace();
      },
      getTranscriptScrollWriteTrace: () =>
        this.transcriptViewport()?.getScrollWriteTrace() ?? [],
      refreshActiveSession: async () => {
        await this.store.refreshActiveSession();
      },
    };

    const testWindow = window as RustyViewTestWindow;
    testWindow.__RUSTY_VIEW_TEST__ = api;
    this.destroyRef.onDestroy(() => {
      if (testWindow.__RUSTY_VIEW_TEST__ === api) {
        delete testWindow.__RUSTY_VIEW_TEST__;
      }
    });
  }
}

function uploadedComposerAttachment(
  attachment: ComposerAttachmentUpload,
  attachmentId: string,
): ComposerAttachmentUpload {
  const withoutError = { ...attachment };
  delete withoutError.error;
  return { ...withoutError, status: 'uploaded', attachmentId };
}

function composerAttachmentWithStatus(
  attachment: ComposerAttachmentUpload,
  status: MessageInputAttachmentStatus,
  error?: string,
): ComposerAttachmentUpload {
  const withoutError = { ...attachment };
  delete withoutError.error;
  return error === undefined
    ? { ...withoutError, status }
    : { ...withoutError, status, error };
}

function composerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newAttachmentMessageIdempotencyKey(): string {
  const id =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `rusty-view-message:${id}`;
}

function confirmCommand(message: string | undefined): Promise<boolean> {
  if (typeof globalThis.confirm === 'function') {
    return Promise.resolve(globalThis.confirm(message ?? 'Run command?'));
  }
  return Promise.resolve(true);
}

function messageText(message: ChatMessage): string {
  return message.blocks
    .filter((block) => block.kind === 'text')
    .map((block) => block.content)
    .join('\n')
    .trim();
}

export function submissionHistory(
  messages: readonly ChatMessage[],
  commands: readonly string[],
): readonly string[] {
  const prompts = [...messages]
    .reverse()
    .filter((message) => message.author.role === 'user')
    .map(messageText)
    .filter((text) => text.length > 0);
  return [...prompts, ...commands].filter(
    (entry, index, entries) => entry !== entries[index - 1],
  );
}

export function cyclicTarget<T>(
  items: readonly T[],
  selectedId: string | null | undefined,
  idFor: (item: T) => string,
  direction: 1 | -1,
): T | undefined {
  if (items.length === 0) return undefined;
  const selectedIndex = items.findIndex((item) => idFor(item) === selectedId);
  if (selectedIndex < 0) return direction === 1 ? items[0] : items.at(-1);
  return items[(selectedIndex + direction + items.length) % items.length];
}

export function canCycleExternalThread(status: string): boolean {
  return status !== 'archived';
}

function metadataString(block: MessageBlock, key: string): string | undefined {
  const value = block.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function metadataStrings(
  block: MessageBlock,
  key: string,
): readonly string[] | undefined {
  const value = block.metadata?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function formatExternalDetail(json: string): string {
  try {
    const parsed: unknown = JSON.parse(json);
    return findDiffText(parsed) ?? JSON.stringify(parsed, null, 2);
  } catch {
    return json;
  }
}

function findDiffText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const diff = findDiffText(item);
      if (diff !== undefined) return diff;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['diff', 'patch']) {
    if (typeof record[key] === 'string') return record[key];
  }
  for (const nested of Object.values(record)) {
    const diff = findDiffText(nested);
    if (diff !== undefined) return diff;
  }
  return undefined;
}

interface RustyViewTestApi {
  getActiveSessionId(): string | null;
  getConnectionStatus(): string;
  getIsGenerating(): boolean;
  getIsStreaming(): boolean;
  getStreamingCharCount(): number;
  getLastCursor(): string | null;
  getMessageCount(): number;
  getDisplayedMessageCount(): number;
  getDisplayedMessages(): readonly {
    readonly id: string;
    readonly role: string;
    readonly status: string;
    readonly blockKinds: readonly string[];
    readonly text: string;
  }[];
  getRawEventCount(): number;
  getBackendBaseUrl(): string;
  getMessages(): readonly {
    readonly id: string;
    readonly role: string;
    readonly status: string;
    readonly blockKinds: readonly string[];
    readonly text: string;
  }[];
  scrollToMessageId(messageId: string): void;
  scrollTranscriptToLatest(): void;
  setTranscriptScrollDiagnosticsEnabled(enabled: boolean): void;
  clearTranscriptScrollWriteTrace(): void;
  getTranscriptScrollWriteTrace(): readonly TranscriptScrollWriteTrace[];
  refreshActiveSession(): Promise<void>;
}

type RustyViewTestWindow = Window &
  typeof globalThis & {
    __RUSTY_VIEW_TEST__?: RustyViewTestApi;
  };
