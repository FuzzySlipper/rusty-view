export type SessionStatusTone =
  | 'idle'
  | 'active'
  | 'completed'
  | 'error'
  | 'warning'
  | 'muted';

/** Human-readable casing for protocol-owned session and turn status values. */
export function sessionStatusLabel(status: string): string {
  return status
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map(
      (part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join(' ');
}

/**
 * Stable visual semantics for protocol-owned session and turn statuses.
 *
 * Protocols may add aliases without forcing each session-list component to
 * independently choose colors. Unknown values intentionally remain muted
 * while their text label stays visible.
 */
export function sessionStatusTone(status: string): SessionStatusTone {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'idle':
    case 'ready':
    case 'available':
      return 'idle';

    case 'accepted':
    case 'active':
    case 'in_progress':
    case 'running':
    case 'sending':
    case 'starting':
    case 'streaming':
    case 'working':
      return 'active';

    case 'applied':
    case 'complete':
    case 'completed':
    case 'done':
    case 'fulfilled':
    case 'resolved':
    case 'succeeded':
    case 'success':
      return 'completed';

    case 'error':
    case 'errored':
    case 'failed':
    case 'failure':
    case 'outcome_unknown':
    case 'rejected':
      return 'error';

    case 'attention':
    case 'blocked':
    case 'expired':
    case 'interrupted':
    case 'paused':
    case 'pending':
    case 'waiting':
    case 'waiting_interaction':
      return 'warning';

    case 'archived':
    case 'canceled':
    case 'cancelled':
    case 'disabled':
    case 'inactive':
    case 'offline':
    case 'stopped':
    case 'unknown':
    default:
      return 'muted';
  }
}
