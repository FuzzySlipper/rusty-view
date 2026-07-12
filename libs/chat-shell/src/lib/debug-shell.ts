import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ChatStore, ExternalAgentStore } from '@rusty-view/chat-store';
import type { MessageBlock } from '@rusty-view/chat-domain';
import {
  ContextDiagnosticsComponent,
  MessageInputComponent,
  StreamStatusComponent,
  TooltipDirective,
  matchesHotkey,
} from '@rusty-view/chat-components';
import type { StreamStatusKind } from '@rusty-view/chat-components';
import type { ChatCommandDescriptor } from '@rusty-view/protocol';
import {
  MESSAGE_BLOCK_DETAIL_LOADER,
  TOOL_CALL_DEBUG_DETAIL_LOADER,
  TranscriptViewportComponent,
  type MessageBlockDetail,
  type MessageRevisionAction,
  type MessageRevisionCapabilities,
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly slashCommands =
    inject(CHAT_SLASH_COMMANDS, { optional: true }) ?? [];
  private readonly transcriptViewport = viewChild(TranscriptViewportComponent);

  protected readonly showInspector = signal(true);
  protected readonly showProfiles = signal(true);
  protected readonly showTranscriptSearch = signal(false);
  protected readonly sidebarMode = signal<'profiles' | 'agents'>('profiles');
  /** Which inspector tab is shown: the raw event log or context diagnostics. */
  protected readonly inspectorTab = signal<'events' | 'context'>('events');
  protected readonly selectedEventId = signal<string | undefined>(undefined);
  protected readonly contextLoading = signal(false);
  protected readonly pluginCommandPending = signal(false);
  protected readonly pluginCommandError = signal<string | undefined>(undefined);

  protected readonly connectionStatus = computed<StreamStatusKind>(() => {
    const state = this.store.connectionState();
    return state.status as StreamStatusKind;
  });

  protected readonly cursorLabel = computed(() => {
    const cursor = this.store.lastCursor();
    return cursor ?? '—';
  });

  /** Disable the message input when streaming OR a submission is in flight. */
  protected readonly inputDisabled = computed(
    () =>
      (this.external.selectedThreadId() === undefined &&
        (this.store.isGenerating() || this.store.isSubmitting())) ||
      (this.external.selectedThreadId() !== undefined &&
        this.external.loading()) ||
      this.external.pending() ||
      this.pluginCommandPending(),
  );

  protected readonly externalSelected = computed(
    () => this.external.selectedThreadId() !== undefined,
  );
  protected readonly displayedMessages = computed(() =>
    this.externalSelected() ? this.external.messages() : this.store.messages(),
  );
  protected readonly hasConversation = computed(
    () => this.externalSelected() || this.store.activeSessionId() !== undefined,
  );
  protected readonly externalAttention = computed(() =>
    this.external
      .sessions()
      .some((session) => session.needsAttention || session.unread),
  );

  protected readonly inputCommands = computed<readonly ChatCommandDescriptor[]>(
    () => [
      ...this.store.commands(),
      ...this.slashCommands.map((command) => pluginCommandDescriptor(command)),
    ],
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
  }

  @HostListener('document:keydown', ['$event'])
  protected onGlobalHotkey(event: KeyboardEvent): void {
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

  protected onSelectSession(sessionId: string): void {
    void this.store.selectSession(sessionId);
  }

  private cycleSession(direction: 1 | -1): void {
    if (this.sidebarMode() === 'agents') {
      const sessions = this.external
        .sessions()
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

    const target = cyclicTarget(
      this.store.profiles(),
      this.store.selectedProfileId(),
      (profile) => profile.profileId,
      direction,
    );
    if (target !== undefined) void this.store.selectProfile(target.profileId);
  }

  protected onSendMessage(text: string): void {
    if (this.externalSelected()) {
      void this.external.send(text);
      return;
    }
    if (text.startsWith('/') && this.hasPluginCommand(text)) {
      void this.runPluginCommand(text);
      return;
    }

    void this.store.submit(text);
  }

  protected onReconnect(): void {
    void this.store.reconnect();
  }

  protected toggleInspector(): void {
    this.showInspector.update((v) => !v);
  }

  protected toggleProfiles(): void {
    this.showProfiles.update((v) => !v);
  }

  protected showSidebar(mode: 'profiles' | 'agents'): void {
    this.sidebarMode.set(mode);
    if (mode === 'profiles') this.external.clearSelection();
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

function confirmCommand(message: string | undefined): Promise<boolean> {
  if (typeof globalThis.confirm === 'function') {
    return Promise.resolve(globalThis.confirm(message ?? 'Run command?'));
  }
  return Promise.resolve(true);
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
}

type RustyViewTestWindow = Window &
  typeof globalThis & {
    __RUSTY_VIEW_TEST__?: RustyViewTestApi;
  };
