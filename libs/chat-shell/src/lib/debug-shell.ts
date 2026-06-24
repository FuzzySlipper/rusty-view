import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ChatStore } from '@rusty-view/chat-store';
import {
  MessageInputComponent,
  StreamStatusComponent,
} from '@rusty-view/chat-components';
import type { StreamStatusKind } from '@rusty-view/chat-components';
import { TranscriptViewportComponent } from '@rusty-view/transcript-renderer';
import { EventInspectorComponent } from './event-inspector';
import { ProfilePanelComponent } from './profile-panel';
import { TopMenuComponent } from './top-menu';

/**
 * Debug chat shell — the composition layer that wires everything together.
 *
 * Layout: header with stream status → profile sidebar → central transcript +
 * message input → event inspector panel. Dense, workbench-style, roleplay-
 * agnostic.
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
    TopMenuComponent,
  ],
  templateUrl: './debug-shell.html',
  styleUrl: './debug-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebugShellComponent {
  protected readonly store = inject(ChatStore);

  protected readonly showInspector = signal(true);
  protected readonly selectedEventId = signal<string | undefined>(undefined);

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
    () => this.store.isGenerating() || this.store.isSubmitting(),
  );

  protected readonly isViewingHistorical = computed(
    () => this.store.isViewingHistorical(),
  );

  protected readonly viewingSessionId = computed(
    () => this.store.viewingHistoricalSessionId(),
  );

  protected onSelectSession(sessionId: string): void {
    void this.store.selectSession(sessionId);
  }

  protected onSendMessage(text: string): void {
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

  protected onReturnToActive(): void {
    void this.store.returnToActiveSession();
  }
}
