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
