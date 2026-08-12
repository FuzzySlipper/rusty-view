import type { ReviewOperatorPipelineItem } from '@rusty-view/protocol';
import { filterPipelineItems } from './den-review-operator-store';

describe('Den review operator projection', () => {
  const items: ReviewOperatorPipelineItem[] = [
    {
      stableId: 'managed-1',
      projectId: 'rusty-view',
      taskId: 6854,
      stage: 'reviewer_delivery_retrying',
      task: { title: 'Review cockpit' },
      latestRound: { id: 11 },
      latestGate: { status: 'passed' },
      submission: {
        submissionId: 'managed-1',
        projectId: 'rusty-view',
        taskId: '6854',
        reviewer: '@reviewer',
        phase: 'reviewer_dispatch_pending',
        updatedAt: '2026-08-12T00:00:00.000Z',
        lastAdapterError: 'reviewer unavailable',
      } as never,
    },
    {
      stableId: 'den-task:rusty-view:6855',
      projectId: 'rusty-view',
      taskId: 6855,
      stage: 'den_reviewable_not_submitted',
      task: { title: 'Direct review' },
      latestRound: null,
      latestGate: null,
    },
  ];

  it('filters by task, state, reviewer, age, and failures without inventing managed state', () => {
    expect(
      filterPipelineItems(
        items,
        {
          task: 'cockpit',
          state: 'retrying',
          reviewer: 'reviewer',
          failuresOnly: true,
          minimumAgeMinutes: 30,
        },
        Date.parse('2026-08-12T01:00:00.000Z'),
      ).map((item) => item.stableId),
    ).toEqual(['managed-1']);
    expect(items[1]?.submission).toBeUndefined();
  });
});
