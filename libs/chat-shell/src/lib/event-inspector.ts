import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ChatEvent } from '@rusty-view/protocol';
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
  readonly events = input<readonly ChatEvent[]>([]);
  readonly selectedEventId = input<string | undefined>(undefined);

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
    stream_error: 'rv-event-kind--error',
    unknown: 'rv-event-kind--unknown',
  };

  protected selectedEvent(events: readonly ChatEvent[]): ChatEvent | undefined {
    const id = this.selectedEventId();
    if (id === undefined) return undefined;
    return events.find((e) => e.event_id === id);
  }
}
