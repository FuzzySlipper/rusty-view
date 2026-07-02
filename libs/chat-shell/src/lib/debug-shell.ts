import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ChatStore } from '@rusty-view/chat-store';
import {
  ContextDiagnosticsComponent,
  MessageInputComponent,
  StreamStatusComponent,
} from '@rusty-view/chat-components';
import type { StreamStatusKind } from '@rusty-view/chat-components';
import type { ChatCommandDescriptor } from '@rusty-view/protocol';
import { TranscriptViewportComponent } from '@rusty-view/transcript-renderer';
import { EventInspectorComponent } from './event-inspector';
import { ProfilePanelComponent } from './profile-panel';
import { TopMenuComponent } from './top-menu';
import {
  CHAT_SLASH_COMMANDS,
  type ChatPluginCommandResult,
} from './plugin-api';
import {
  executeSlashCommand,
  findSlashCommand,
  pluginCommandDescriptor,
} from './slash-command-runtime';

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
    TranscriptViewportComponent,
    MessageInputComponent,
    StreamStatusComponent,
    EventInspectorComponent,
    ContextDiagnosticsComponent,
    TopMenuComponent,
  ],
  templateUrl: './debug-shell.html',
  styleUrl: './debug-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebugShellComponent {
  protected readonly store = inject(ChatStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly slashCommands =
    inject(CHAT_SLASH_COMMANDS, { optional: true }) ?? [];

  protected readonly showInspector = signal(true);
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
      this.store.isGenerating() ||
      this.store.isSubmitting() ||
      this.pluginCommandPending(),
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

  constructor() {
    this.installTestSnapshotApi();
  }

  protected onSelectSession(sessionId: string): void {
    void this.store.selectSession(sessionId);
  }

  protected onSendMessage(text: string): void {
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
      getLastCursor: () => this.store.lastCursor(),
      getMessageCount: () => this.store.messages().length,
      getRawEventCount: () => this.store.rawEvents().length,
      getMessages: () =>
        this.store.messages().map((message) => ({
          id: message.id,
          role: message.author.role,
          status: message.status,
          blockKinds: message.blocks.map((block) => block.kind),
          text: message.blocks.map((block) => block.content).join('\n'),
        })),
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

interface RustyViewTestApi {
  getActiveSessionId(): string | null;
  getConnectionStatus(): string;
  getIsGenerating(): boolean;
  getIsStreaming(): boolean;
  getLastCursor(): string | null;
  getMessageCount(): number;
  getRawEventCount(): number;
  getMessages(): readonly {
    readonly id: string;
    readonly role: string;
    readonly status: string;
    readonly blockKinds: readonly string[];
    readonly text: string;
  }[];
}

type RustyViewTestWindow = Window &
  typeof globalThis & {
    __RUSTY_VIEW_TEST__?: RustyViewTestApi;
  };
