import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  ChatEvent,
  ExternalThreadProjection,
  NormalizedExternalRuntimeEvent,
} from '@rusty-view/protocol';
import { JsonInspectorComponent } from '@rusty-view/chat-components';

/**
 * Raw event stream inspector for the operator app. Shows the raw protocol events
 * (from the store's rawEvents signal) in a scrollable list, with per-event JSON
 * detail on selection. Uses actual ChatEvent.kind values from the contract.
 */
@Component({
  selector: 'rv-event-inspector',
  imports: [JsonInspectorComponent],
  templateUrl: './event-inspector.html',
  styleUrl: './event-inspector.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventInspectorComponent {
  readonly events = input<readonly InspectorEvent[]>([]);
  readonly externalThread = input<ExternalThreadProjection | undefined>(
    undefined,
  );
  readonly selectedEventId = input<string | undefined>(undefined);
  /** Emits the clicked event's id so the shell can drive the JSON detail. */
  readonly selectEvent = output<string>();
  readonly inspectRawDetail = output<NormalizedExternalRuntimeEvent>();
  protected readonly runtimeFilter = signal('');
  protected readonly sessionFilter = signal('');
  protected readonly turnFilter = signal('');
  protected readonly filteredEvents = computed(() =>
    this.events().filter(
      (event) =>
        includes(this.runtimeId(event), this.runtimeFilter()) &&
        includes(this.sessionId(event), this.sessionFilter()) &&
        includes(this.turnId(event), this.turnFilter()),
    ),
  );

  protected readonly kindColor: Record<string, string> = {
    session_snapshot: 'rv-event-kind--snapshot',
    message_created: 'rv-event-kind--message',
    assistant_turn_started: 'rv-event-kind--turn',
    assistant_text_delta: 'rv-event-kind--delta',
    assistant_message_completed: 'rv-event-kind--message',
    assistant_turn_finished: 'rv-event-kind--turn',
    tool_call_started: 'rv-event-kind--tool',
    tool_call_completed: 'rv-event-kind--tool',
    tool_call_failed: 'rv-event-kind--tool',
    command_started: 'rv-event-kind--command',
    command_completed: 'rv-event-kind--command',
    command_failed: 'rv-event-kind--command',
    context_status: 'rv-event-kind--context',
    context_compaction_started: 'rv-event-kind--context',
    context_compaction_completed: 'rv-event-kind--context',
    context_compaction_failed: 'rv-event-kind--context',
    stream_error: 'rv-event-kind--error',
    unknown: 'rv-event-kind--unknown',
  };

  protected selectedEvent(
    events: readonly InspectorEvent[],
  ): InspectorEvent | undefined {
    const id = this.selectedEventId();
    if (id === undefined) return undefined;
    return events.find((event) => this.eventId(event) === id);
  }
  protected selectedExternalTurn(event: InspectorEvent) {
    if (!this.isExternal(event) || event.nativeTurnId == null) return undefined;
    return this.externalThread()?.turns.find(
      (turn) => turn.turnId === event.nativeTurnId,
    );
  }

  protected eventId(event: InspectorEvent): string {
    return 'event_id' in event ? event.event_id : event.eventId;
  }
  protected sequenceId(event: InspectorEvent): string | number {
    return 'sequence_id' in event ? event.sequence_id : event.sequenceId;
  }
  protected runtimeId(event: InspectorEvent): string {
    return 'runtimeId' in event ? event.runtimeId : '';
  }
  protected sessionId(event: InspectorEvent): string {
    return ('session_id' in event ? event.session_id : event.sessionId) ?? '';
  }
  protected turnId(event: InspectorEvent): string {
    return 'nativeTurnId' in event ? (event.nativeTurnId ?? '') : '';
  }
  protected isExternal(
    event: InspectorEvent,
  ): event is NormalizedExternalRuntimeEvent {
    return 'runtimeId' in event;
  }
  protected updateFilter(
    filter: 'runtime' | 'session' | 'turn',
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    ({
      runtime: this.runtimeFilter,
      session: this.sessionFilter,
      turn: this.turnFilter,
    })[filter].set(value);
  }
}

type InspectorEvent = ChatEvent | NormalizedExternalRuntimeEvent;

function includes(value: string, query: string): boolean {
  return query === '' || value.toLowerCase().includes(query.toLowerCase());
}
