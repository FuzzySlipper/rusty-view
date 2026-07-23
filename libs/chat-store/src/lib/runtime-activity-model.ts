import type {
  RuntimeActivityFinding,
  RuntimeActivityFindingCode,
  RuntimeActivityView,
} from '@rusty-view/transport';

export const INITIAL_RUNTIME_ACTIVITY_FINDING_CODES = [
  'session_projection_mismatch',
  'untracked_native_run',
  'detached_dispatch',
  'orphan_tool_execution',
  'stale_ledger_entry',
  'stalled',
  'restart_interrupted',
  'untracked_service_process',
] as const satisfies readonly RuntimeActivityFindingCode[];

export interface RuntimeActivityRow {
  readonly key: string;
  readonly view: RuntimeActivityView;
  readonly depth: number;
  readonly findings: readonly RuntimeActivityFinding[];
  readonly missingParent: boolean;
}

interface IndexedActivity {
  readonly key: string;
  readonly index: number;
  readonly view: RuntimeActivityView;
}

/**
 * Turn Crew's flat, parent-linked activity projection into dense display rows.
 *
 * Crew remains the authority for reconciliation and findings. This helper only
 * orders and indents the records it receives. Missing parents, cycles, unknown
 * kinds, and duplicate ids remain visible rather than being discarded.
 */
export function projectRuntimeActivityRows(
  views: readonly RuntimeActivityView[],
  findings: readonly RuntimeActivityFinding[],
): readonly RuntimeActivityRow[] {
  const indexed = views.map<IndexedActivity>((view, index) => ({
    key: `${view.activity.activityId}:${index}`,
    index,
    view,
  }));
  const firstById = new Map<string, IndexedActivity>();
  for (const activity of indexed) {
    if (!firstById.has(activity.view.activity.activityId)) {
      firstById.set(activity.view.activity.activityId, activity);
    }
  }

  const children = new Map<string, IndexedActivity[]>();
  const roots: IndexedActivity[] = [];
  for (const activity of indexed) {
    const parentId = activity.view.activity.parentActivityId;
    if (
      parentId === undefined ||
      parentId === null ||
      !firstById.has(parentId)
    ) {
      roots.push(activity);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(activity);
    children.set(parentId, siblings);
  }

  const findingsByActivity = new Map<string, RuntimeActivityFinding[]>();
  for (const finding of findings) {
    const entries = findingsByActivity.get(finding.activityId) ?? [];
    entries.push(finding);
    findingsByActivity.set(finding.activityId, entries);
  }

  const rows: RuntimeActivityRow[] = [];
  const visited = new Set<string>();
  const visit = (activity: IndexedActivity, depth: number): void => {
    if (visited.has(activity.key)) return;
    visited.add(activity.key);
    const record = activity.view.activity;
    rows.push({
      key: activity.key,
      view: activity.view,
      depth,
      findings: findingsByActivity.get(record.activityId) ?? [],
      missingParent:
        record.parentActivityId !== undefined &&
        record.parentActivityId !== null &&
        !firstById.has(record.parentActivityId),
    });
    for (const child of [...(children.get(record.activityId) ?? [])].sort(
      compareActivities,
    )) {
      visit(child, depth + 1);
    }
  };

  for (const root of [...roots].sort(compareActivities)) visit(root, 0);
  // A malformed future payload may contain a parent cycle. Keep those rows
  // visible at root depth instead of recursing forever or dropping them.
  for (const activity of [...indexed].sort(compareActivities)) {
    visit(activity, 0);
  }
  return rows;
}

export function runtimeActivityKindLabel(kind: string): string {
  switch (kind) {
    case 'dispatch':
      return 'Dispatch';
    case 'wake':
      return 'Brain wake';
    case 'provider_request':
      return 'Provider request';
    case 'tool_call':
      return 'Tool call';
    case 'subprocess':
      return 'Subprocess';
    case 'browser':
      return 'Browser';
    case 'external_turn':
      return 'Managed external turn';
    default:
      return `Unknown activity (${kind})`;
  }
}

export function runtimeActivityFindingLabel(code: string): string {
  switch (code) {
    case 'missing_parent':
      return 'Missing parent in snapshot';
    case 'session_projection_mismatch':
      return 'Session projection mismatch';
    case 'untracked_native_run':
      return 'Untracked native run';
    case 'detached_dispatch':
      return 'Detached dispatch';
    case 'orphan_tool_execution':
      return 'Orphan tool execution';
    case 'stale_ledger_entry':
      return 'Stale ledger entry';
    case 'stalled':
      return 'Stalled activity';
    case 'restart_interrupted':
      return 'Restart interrupted';
    case 'untracked_service_process':
      return 'Untracked service process';
    default:
      return `Unknown Crew finding (${code})`;
  }
}

export function runtimeActivityOwnerLabel(owner: string): string {
  switch (owner) {
    case 'rust_coordination':
      return 'Rust coordination';
    case 'rust_brain':
      return 'Rust brain';
    case 'type_script_host':
      return 'TypeScript host';
    case 'external_runtime':
      return 'External runtime';
    default:
      return `Unknown owner (${owner})`;
  }
}

function compareActivities(
  left: IndexedActivity,
  right: IndexedActivity,
): number {
  const leftRecord = left.view.activity;
  const rightRecord = right.view.activity;
  return (
    activityKindRank(leftRecord.kind) - activityKindRank(rightRecord.kind) ||
    leftRecord.startedAt.localeCompare(rightRecord.startedAt) ||
    leftRecord.activityId.localeCompare(rightRecord.activityId) ||
    left.index - right.index
  );
}

function activityKindRank(kind: string): number {
  switch (kind) {
    case 'dispatch':
      return 0;
    case 'wake':
      return 1;
    case 'external_turn':
      return 2;
    case 'provider_request':
      return 3;
    case 'tool_call':
      return 4;
    case 'subprocess':
      return 5;
    case 'browser':
      return 6;
    default:
      return 20;
  }
}
