import {
  branchBreadcrumbs,
  branchJumpTarget,
  snapshotJumpTarget,
} from '../index';
import type { ConversationBranch, ConversationSnapshot } from '../index';

import { describe, expect, it } from 'vitest';

function makeBranch(
  overrides: Partial<ConversationBranch>,
): ConversationBranch {
  return {
    id: 'branch_root',
    parentMessageId: undefined,
    label: undefined,
    createdAt: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ConversationSnapshot>,
): ConversationSnapshot {
  return {
    id: 'snap_1',
    messageId: 'm1',
    label: undefined,
    summary: undefined,
    createdAt: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

describe('conversation navigation', () => {
  it('builds branch breadcrumbs from root to active branch', () => {
    const branches = [
      makeBranch({
        id: 'root',
        label: 'Root',
        headMessageId: 'm_root',
      }),
      makeBranch({
        id: 'child',
        parentBranchId: 'root',
        label: 'Child',
        headMessageId: 'm_child',
      }),
      makeBranch({
        id: 'leaf',
        parentBranchId: 'child',
        label: 'Leaf',
        headMessageId: 'm_leaf',
      }),
    ];

    const breadcrumbs = branchBreadcrumbs(branches, 'leaf');

    expect(breadcrumbs.map((crumb) => crumb.branch.id)).toEqual([
      'root',
      'child',
      'leaf',
    ]);
    expect(breadcrumbs.map((crumb) => crumb.depth)).toEqual([0, 1, 2]);
    expect(breadcrumbs.map((crumb) => crumb.target?.messageId)).toEqual([
      'm_root',
      'm_child',
      'm_leaf',
    ]);
  });

  it('uses branch head, then origin, then parent message as jump target', () => {
    expect(
      branchJumpTarget(
        makeBranch({
          id: 'head',
          headMessageId: 'm_head',
          originMessageId: 'm_origin',
          parentMessageId: 'm_parent',
        }),
      )?.messageId,
    ).toBe('m_head');

    expect(
      branchJumpTarget(
        makeBranch({
          id: 'origin',
          originMessageId: 'm_origin',
          parentMessageId: 'm_parent',
        }),
      )?.messageId,
    ).toBe('m_origin');

    expect(
      branchJumpTarget(
        makeBranch({ id: 'parent', parentMessageId: 'm_parent' }),
      )?.messageId,
    ).toBe('m_parent');
  });

  it('builds snapshot jump targets from message ids', () => {
    const target = snapshotJumpTarget(
      makeSnapshot({ id: 'snap_a', label: 'Snapshot A', messageId: 'm_snap' }),
    );

    expect(target).toEqual({
      kind: 'snapshot',
      id: 'snap_a',
      messageId: 'm_snap',
      label: 'Snapshot A',
    });
  });

  it('stops breadcrumb walks on cycles', () => {
    const breadcrumbs = branchBreadcrumbs(
      [
        makeBranch({ id: 'a', parentBranchId: 'b', headMessageId: 'm_a' }),
        makeBranch({ id: 'b', parentBranchId: 'a', headMessageId: 'm_b' }),
      ],
      'a',
    );

    expect(breadcrumbs.map((crumb) => crumb.branch.id)).toEqual(['b', 'a']);
  });
});
