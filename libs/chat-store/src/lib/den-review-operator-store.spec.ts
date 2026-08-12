import { TestBed } from '@angular/core/testing';
import type { ReviewOperatorPipelineItem } from '@rusty-view/protocol';
import { ChatTransport } from '@rusty-view/transport';
import { vi } from 'vitest';
import {
  DenReviewOperatorStore,
  filterPipelineItems,
} from './den-review-operator-store';

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

  it('retains one prompt identity across an ambiguous failure and rotates it after success', async () => {
    const promptReviewerForTask = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ command: 'review 6854' })
      .mockResolvedValueOnce({ command: 'review 6854' });
    const transport = {
      getConfig: () => ({ coordinationRole: 'debug' }),
      external: {
        readReviewOperatorConfig: vi.fn(async () => ({
          deploymentRole: 'debug',
        })),
        readReviewOperatorPipeline: vi.fn(async () => ({ items: [] })),
        writeReviewOperatorConfig: vi.fn(),
        promptReviewerForTask,
      },
    };
    TestBed.configureTestingModule({
      providers: [
        DenReviewOperatorStore,
        { provide: ChatTransport, useValue: transport },
      ],
    });
    const store = TestBed.inject(DenReviewOperatorStore);
    await store.refresh();

    expect(await store.promptReviewer(6854)).toBe(false);
    expect(await store.promptReviewer(6854)).toBe(true);
    expect(await store.promptReviewer(6854)).toBe(true);

    const first = promptReviewerForTask.mock.calls[0]?.[1];
    const retry = promptReviewerForTask.mock.calls[1]?.[1];
    const distinctAction = promptReviewerForTask.mock.calls[2]?.[1];
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.correlationId).toBe(first.correlationId);
    expect(distinctAction.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('abandons the captured prompt identity after a project switch', async () => {
    const promptReviewerForTask = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ command: 'review 6854' });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DenReviewOperatorStore,
        {
          provide: ChatTransport,
          useValue: {
            getConfig: () => ({ coordinationRole: 'debug' }),
            external: {
              readReviewOperatorConfig: vi.fn(async () => ({
                deploymentRole: 'debug',
              })),
              readReviewOperatorPipeline: vi.fn(async () => ({ items: [] })),
              writeReviewOperatorConfig: vi.fn(),
              promptReviewerForTask,
            },
          },
        },
      ],
    });
    const store = TestBed.inject(DenReviewOperatorStore);
    await store.refresh();
    const captured = {
      projectId: 'rusty-view',
      deploymentRole: 'debug' as const,
    };

    expect(await store.promptReviewer(6854, captured)).toBe(false);
    store.setProjectId('another-project');
    store.abandonPromptReviewer(6854, captured);
    expect(await store.promptReviewer(6854, captured)).toBe(true);

    const abandoned = promptReviewerForTask.mock.calls[0]?.[1];
    const newAction = promptReviewerForTask.mock.calls[1]?.[1];
    expect(newAction.idempotencyKey).not.toBe(abandoned.idempotencyKey);
    expect(newAction.correlationId).not.toBe(abandoned.correlationId);
  });

  it('replaces bounded pages without duplicating or rewriting stable identities', async () => {
    const readReviewOperatorPipeline = vi
      .fn()
      .mockResolvedValueOnce({
        projectId: 'rusty-view',
        deploymentRole: 'debug',
        limit: 1,
        offset: 0,
        nextOffset: 1,
        items: [items[0]],
      })
      .mockResolvedValueOnce({
        projectId: 'rusty-view',
        deploymentRole: 'debug',
        limit: 1,
        offset: 1,
        items: [items[1]],
      });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DenReviewOperatorStore,
        {
          provide: ChatTransport,
          useValue: {
            getConfig: () => ({ coordinationRole: 'debug' }),
            external: {
              readReviewOperatorConfig: vi.fn(async () => ({
                deploymentRole: 'debug',
              })),
              readReviewOperatorPipeline,
            },
          },
        },
      ],
    });
    const store = TestBed.inject(DenReviewOperatorStore);
    await store.refresh(0);
    expect(store.pipeline()?.items.map((item) => item.stableId)).toEqual([
      'managed-1',
    ]);
    await store.refresh(1);
    expect(store.pipeline()?.items.map((item) => item.stableId)).toEqual([
      'den-task:rusty-view:6855',
    ]);
  });
});
