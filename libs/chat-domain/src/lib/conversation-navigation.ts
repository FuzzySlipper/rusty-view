import type { ConversationBranch, ConversationSnapshot } from './domain-types';

export type ConversationNavigationTargetKind =
  | 'message'
  | 'branch'
  | 'snapshot';

export interface ConversationNavigationTarget {
  readonly kind: ConversationNavigationTargetKind;
  readonly id: string;
  readonly messageId: string;
  readonly label: string | undefined;
}

export interface ConversationBranchBreadcrumb {
  readonly branch: ConversationBranch;
  readonly depth: number;
  readonly target: ConversationNavigationTarget | undefined;
}

export function branchJumpTarget(
  branch: ConversationBranch,
): ConversationNavigationTarget | undefined {
  const messageId =
    branch.headMessageId ?? branch.originMessageId ?? branch.parentMessageId;
  if (messageId === undefined) return undefined;

  return {
    kind: 'branch',
    id: branch.id,
    messageId,
    label: branch.label,
  };
}

export function snapshotJumpTarget(
  snapshot: ConversationSnapshot,
): ConversationNavigationTarget | undefined {
  if (snapshot.messageId === undefined) return undefined;

  return {
    kind: 'snapshot',
    id: snapshot.id,
    messageId: snapshot.messageId,
    label: snapshot.label,
  };
}

export function messageJumpTarget(
  messageId: string,
): ConversationNavigationTarget {
  return {
    kind: 'message',
    id: messageId,
    messageId,
    label: undefined,
  };
}

export function branchBreadcrumbs(
  branches: readonly ConversationBranch[],
  activeBranchId: string | undefined,
): readonly ConversationBranchBreadcrumb[] {
  if (activeBranchId === undefined) return [];

  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const path: ConversationBranch[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = activeBranchId;

  while (currentId !== undefined && !seen.has(currentId)) {
    seen.add(currentId);
    const branch = byId.get(currentId);
    if (branch === undefined) break;

    path.push(branch);
    currentId = branch.parentBranchId;
  }

  return path.reverse().map((branch, index) => ({
    branch,
    depth: index,
    target: branchJumpTarget(branch),
  }));
}
