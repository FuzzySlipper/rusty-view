import { describe, expect, it } from 'vitest';
import type {
  RuntimeActivityFinding,
  RuntimeActivityView,
} from '@rusty-view/transport';

import {
  INITIAL_RUNTIME_ACTIVITY_FINDING_CODES,
  projectRuntimeActivityRows,
  runtimeActivityFindingLabel,
  runtimeActivityKindLabel,
} from './runtime-activity-model';

describe('runtime activity model', () => {
  it('projects the Crew-owned parent topology without losing unknown kinds', () => {
    const views = [
      activity('process:1', 'subprocess', 'tool:1'),
      activity('dispatch:1', 'dispatch'),
      activity('future:1', 'future_activity'),
      activity('tool:1', 'tool_call', 'provider:1'),
      activity('wake:1', 'wake', 'dispatch:1'),
      activity('provider:1', 'provider_request', 'wake:1'),
    ];

    const rows = projectRuntimeActivityRows(views, []);

    expect(
      rows.map((row) => [
        row.view.activity.activityId,
        row.depth,
        row.missingParent,
      ]),
    ).toEqual([
      ['dispatch:1', 0, false],
      ['wake:1', 1, false],
      ['provider:1', 2, false],
      ['tool:1', 3, false],
      ['process:1', 4, false],
      ['future:1', 0, false],
    ]);
    expect(runtimeActivityKindLabel('future_activity')).toBe(
      'Unknown activity (future_activity)',
    );
  });

  it('keeps orphaned and cyclic records visible', () => {
    const rows = projectRuntimeActivityRows(
      [
        activity('orphan:1', 'browser', 'missing:1'),
        activity('cycle:a', 'tool_call', 'cycle:b'),
        activity('cycle:b', 'subprocess', 'cycle:a'),
      ],
      [],
    );

    expect(rows.map((row) => row.view.activity.activityId).sort()).toEqual([
      'cycle:a',
      'cycle:b',
      'orphan:1',
    ]);
    expect(
      rows.find((row) => row.view.activity.activityId === 'orphan:1')
        ?.missingParent,
    ).toBe(true);
  });

  it('labels every initial Crew finding and preserves unknown codes', () => {
    for (const code of INITIAL_RUNTIME_ACTIVITY_FINDING_CODES) {
      expect(runtimeActivityFindingLabel(code)).not.toContain('Unknown');
    }
    expect(runtimeActivityFindingLabel('future_reason')).toBe(
      'Unknown Crew finding (future_reason)',
    );
  });

  it('attaches Crew findings to their matching activity rows', () => {
    const finding = {
      code: 'stalled',
      activityId: 'wake:1',
      message: 'no progress within threshold',
    } satisfies RuntimeActivityFinding;

    const rows = projectRuntimeActivityRows(
      [activity('wake:1', 'wake')],
      [finding],
    );

    expect(rows[0]?.findings).toEqual([finding]);
  });
});

function activity(
  activityId: string,
  kind: string,
  parentActivityId?: string,
): RuntimeActivityView {
  return {
    activity: {
      activityId,
      serviceInstanceId: 'service-test',
      kind,
      owner: 'rust_brain',
      status: 'active',
      phase: 'running',
      startedAt: '2026-07-23T00:00:00Z',
      lastProgressAt: '2026-07-23T00:00:01Z',
      revision: 1,
      ...(parentActivityId === undefined ? {} : { parentActivityId }),
    },
    elapsedMs: 1_000,
    sinceProgressMs: 100,
  } as RuntimeActivityView;
}
