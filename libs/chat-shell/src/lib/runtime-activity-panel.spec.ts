import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeActivityCensus } from '@rusty-view/transport';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';

import { RuntimeActivityPanelComponent } from './runtime-activity-panel';

describe('RuntimeActivityPanelComponent', () => {
  it('renders dense hierarchy, every Crew finding, and unknown future values', async () => {
    const census = signal<RuntimeActivityCensus | null>(activityCensus());
    const refreshActivities = vi.fn(async () => true);
    const fixture = await createPanel({
      activityCensus: census,
      refreshActivities,
      stale: true,
      error: 'temporary poll failure',
    });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Stale snapshot');
    expect(host.textContent).toContain('Showing the last successful snapshot');
    expect(host.textContent).toContain('Dispatch');
    expect(host.textContent).toContain('Unknown activity (future_activity)');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);

    for (const code of [
      'session_projection_mismatch',
      'untracked_native_run',
      'detached_dispatch',
      'orphan_tool_execution',
      'stale_ledger_entry',
      'stalled',
      'restart_interrupted',
      'untracked_service_process',
    ]) {
      expect(host.textContent).toContain(code);
    }
    expect(host.textContent).toContain('Unknown Crew finding (future_reason)');

    const projection = host.querySelector<HTMLSelectElement>(
      '[data-testid="activity-projection-mode"]',
    );
    if (projection === null) throw new Error('projection selector missing');
    projection.value = 'durable';
    projection.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(refreshActivities).toHaveBeenLastCalledWith('durable');

    fixture.destroy();
  });

  it('distinguishes an unavailable census from a Crew-confirmed empty state', async () => {
    const fixture = await createPanel({
      activityCensus: signal(null),
      refreshActivities: vi.fn(async () => false),
      stale: false,
      error: 'activity endpoint unavailable',
    });
    const host = fixture.nativeElement as HTMLElement;

    expect(
      host.querySelector('[data-testid="activity-unavailable"]'),
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="activity-empty"]')).toBeNull();
    expect(host.textContent).toContain('This is not an empty-work result');

    fixture.destroy();
  });
});

async function createPanel(input: {
  readonly activityCensus: ReturnType<
    typeof signal<RuntimeActivityCensus | null>
  >;
  readonly refreshActivities: ReturnType<typeof vi.fn>;
  readonly stale: boolean;
  readonly error: string | null;
}) {
  const activityLoading = signal(false);
  await TestBed.configureTestingModule({
    imports: [RuntimeActivityPanelComponent],
    providers: [
      {
        provide: AdminStore,
        useValue: {
          activityCensus: input.activityCensus,
          activityLoading,
          activityError: () => input.error,
          activitySnapshotStale: () => input.stale,
          activityLastSuccessfulUpdate: () => '2026-07-23T00:00:02Z',
          activityProjectionMode: () => 'service',
          refreshActivities: input.refreshActivities,
        },
      },
      {
        provide: ChatStore,
        useValue: {
          selectSession: vi.fn(async () => undefined),
          loadProviderRequestDebugDetail: vi.fn(async () => ({})),
          loadToolCallDebugDetail: vi.fn(async () => ({})),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(RuntimeActivityPanelComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function activityCensus(): RuntimeActivityCensus {
  const findingCodes = [
    'session_projection_mismatch',
    'untracked_native_run',
    'detached_dispatch',
    'orphan_tool_execution',
    'stale_ledger_entry',
    'stalled',
    'restart_interrupted',
    'untracked_service_process',
    'future_reason',
  ];
  return {
    generatedAt: '2026-07-23T00:00:01Z',
    serviceInstanceId: 'service-test',
    active: [
      activity('dispatch:1', 'dispatch'),
      activity('future:1', 'future_activity', 'dispatch:1'),
    ],
    recentlyAbnormal: [
      {
        ...activity('wake:old', 'wake'),
        activity: {
          ...activity('wake:old', 'wake').activity,
          status: 'interrupted',
          reasonCode: 'restart_interrupted',
          terminalAt: '2026-07-23T00:00:00Z',
        },
      },
    ],
    findings: findingCodes.map((code, index) => ({
      code,
      activityId: index === 0 ? 'dispatch:1' : 'future:1',
      message: `finding ${code}`,
    })),
    summary: {
      active: 2,
      recentlyAbnormal: 1,
      findings: findingCodes.length,
      untrackedProcesses: 1,
    },
    automaticCancellationEnabled: false,
  } as RuntimeActivityCensus;
}

function activity(activityId: string, kind: string, parentActivityId?: string) {
  return {
    activity: {
      activityId,
      serviceInstanceId: 'service-test',
      kind,
      owner: 'rust_coordination',
      status: 'active',
      phase: 'running',
      startedAt: '2026-07-23T00:00:00Z',
      lastProgressAt: '2026-07-23T00:00:01Z',
      revision: 1,
      agentId: 'agent-1',
      profileId: 'profile-1',
      sessionId: 'session-1',
      wakeId: 'wake-1',
      ...(parentActivityId === undefined ? {} : { parentActivityId }),
    },
    elapsedMs: 1_000,
    sinceProgressMs: 100,
  };
}
