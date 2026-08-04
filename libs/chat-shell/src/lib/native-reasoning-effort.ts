import type { SessionContextUsageResult } from '@rusty-view/protocol';

type ProviderContext = SessionContextUsageResult['provider'];

const SOURCE_LABELS: Record<
  NonNullable<ProviderContext['reasoning_effort_source']>,
  string
> = {
  session_override: 'session override',
  profile: 'profile default',
  provider_default: 'provider default',
};

/**
 * Presents the effective native Crew effort without inventing a second
 * vocabulary. The API owns both the value and its provenance; a missing
 * value is deliberately visible instead of being mistaken for a default.
 */
export function formatNativeReasoningEffort(
  provider: ProviderContext | undefined,
): string {
  const effort = provider?.reasoning_effort?.trim();
  const source = provider?.reasoning_effort_source;

  if (!effort) {
    return source === 'provider_default'
      ? 'default · provider default'
      : 'unavailable';
  }

  const sourceLabel = source === undefined ? undefined : SOURCE_LABELS[source];
  return sourceLabel === undefined ? effort : `${effort} · ${sourceLabel}`;
}
