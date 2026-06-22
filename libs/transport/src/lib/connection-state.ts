import type { ChatTransportError } from './chat-transport-error';

/**
 * Framework-neutral connection state for an SSE event stream.
 *
 * Transport owns this state (it is the transport-layer concern of "is the wire
 * connected"). The Angular chat-store adapts it to Signals — transport itself
 * never touches Angular.
 *
 * Discriminated by `status` so the store/UI can switch exhaustively.
 */
export type ChatConnectionState =
  | { readonly status: 'idle' }
  | { readonly status: 'connecting' }
  | { readonly status: 'connected'; readonly lastCursor?: string }
  | {
      readonly status: 'reconnecting';
      readonly attempt: number;
      readonly lastCursor?: string;
      readonly nextAttemptMs: number;
    }
  | { readonly status: 'closed' }
  | { readonly status: 'error'; readonly error: ChatTransportError };

/** Callback invoked when connection state changes. */
export type ConnectionStateListener = (state: ChatConnectionState) => void;

/** Unsubscribe function returned by state-change subscriptions. */
export type Unsubscribe = () => void;

/**
 * Helper for the stream session to manage a set of listeners and current state.
 * Not exported — internal to transport.
 */
export class ConnectionStateTracker {
  private current: ChatConnectionState = { status: 'idle' };
  private readonly listeners = new Set<ConnectionStateListener>();

  getState(): ChatConnectionState {
    return this.current;
  }

  setState(next: ChatConnectionState): void {
    this.current = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  subscribe(listener: ConnectionStateListener): Unsubscribe {
    this.listeners.add(listener);
    // Immediately deliver the current state to new subscribers.
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.listeners.clear();
  }
}
