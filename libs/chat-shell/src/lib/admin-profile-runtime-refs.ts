import type { ProfileRegistryDerivedRuntimeRef } from '@rusty-view/transport';

/** A group of derived runtime refs sharing a `refKind`, for preview rendering. */
export interface RuntimeRefGroup {
  readonly refKind: string;
  readonly label: string;
  readonly refs: readonly ProfileRegistryDerivedRuntimeRef[];
}

const RUNTIME_REF_KIND_ORDER: readonly string[] = [
  'brain',
  'session',
  'scheduled_job',
  'channel_binding',
  'mcp_binding',
  'profile_mcp_config',
];

/**
 * Group a profile's derived runtime refs by `refKind` for the runtime-graph
 * preview. Returns groups in a stable order (runtime agents, sessions, jobs,
 * channel bindings, MCP bindings, then any other kinds). Shared by the create and edit
 * profile windows (#3690).
 */
export function groupRuntimeRefs(
  refs: readonly ProfileRegistryDerivedRuntimeRef[],
): readonly RuntimeRefGroup[] {
  if (refs.length === 0) return [];
  const buckets = new Map<string, ProfileRegistryDerivedRuntimeRef[]>();
  for (const ref of refs) {
    const existing = buckets.get(ref.refKind);
    if (existing === undefined) {
      buckets.set(ref.refKind, [ref]);
    } else {
      existing.push(ref);
    }
  }
  const orderedKinds = [
    ...RUNTIME_REF_KIND_ORDER.filter((kind) => buckets.has(kind)),
    ...[...buckets.keys()]
      .filter((kind) => !RUNTIME_REF_KIND_ORDER.includes(kind))
      .sort(),
  ];
  return orderedKinds.map((refKind) => ({
    refKind,
    label: runtimeRefKindLabel(refKind),
    refs: buckets.get(refKind) ?? [],
  }));
}

function runtimeRefKindLabel(refKind: string): string {
  switch (refKind) {
    case 'brain':
      return 'Agent runtime';
    case 'session':
      return 'Conversation sessions';
    case 'scheduled_job':
      return 'Scheduled jobs';
    case 'channel_binding':
      return 'Channel bindings';
    case 'mcp_binding':
    case 'profile_mcp_config':
      return 'Tool connections';
    default:
      return refKind;
  }
}
