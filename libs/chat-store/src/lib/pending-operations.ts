import type { ChatActor } from '@rusty-view/protocol';
import type { StoreErrorDetail } from './store-error';

/** A pending send-message operation tracked by the store. */
export interface PendingSend {
  readonly id: string;
  readonly sessionId: string;
  readonly text: string;
  readonly idempotencyKey?: string;
  readonly status: 'sending' | 'error';
  readonly error: StoreErrorDetail | undefined;
}

/** Build the ordinary human actor envelope from the local soft identity. */
export function userActor(identity: string): ChatActor {
  return {
    id: identity,
    kind: 'human',
  } as const satisfies ChatActor;
}
