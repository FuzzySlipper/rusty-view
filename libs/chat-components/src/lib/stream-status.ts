import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/**
 * Connection status values the {@link StreamStatusComponent} can render. These
 * mirror the `status` field of transport's `ChatConnectionState` without the
 * component needing to import from transport — it stays purely presentational.
 * The shell maps transport state to this type at the container boundary.
 */
export type StreamStatusKind =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'error';

/**
 * Presentational stream status indicator.
 *
 * Shows connection state as a colored dot + label. Clicking emits `reconnect`
 * so the parent can trigger a manual reconnect. No transport or store access —
 * the shell passes the status string derived from transport's connection state.
 */
@Component({
  selector: 'rv-stream-status',
  templateUrl: './stream-status.html',
  styleUrl: './stream-status.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StreamStatusComponent {
  readonly status = input.required<StreamStatusKind>();
  readonly reconnect = output<void>();

  protected readonly statusClass = computed(() => {
    return `rv-status--${this.status()}`;
  });

  protected readonly label = computed(() => {
    switch (this.status()) {
      case 'idle':
        return 'Idle';
      case 'connecting':
        return 'Connecting…';
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return 'Reconnecting…';
      case 'closed':
        return 'Disconnected';
      case 'error':
        return 'Error';
    }
  });
}
