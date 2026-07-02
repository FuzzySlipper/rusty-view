import type { ChatActor } from '@rusty-view/protocol';
import type { StoreErrorDetail } from './store-error';

/** A pending send-message operation tracked by the store. */
export interface PendingSend {
  readonly id: string;
  readonly text: string;
  readonly status: 'sending' | 'error';
  readonly error: StoreErrorDetail | undefined;
}

/** Default actor for the operator app — overridden by the shell if needed. */
export const DEBUG_ACTOR: ChatActor = {
  id: 'debug-user',
  kind: 'human',
} as const satisfies ChatActor;
