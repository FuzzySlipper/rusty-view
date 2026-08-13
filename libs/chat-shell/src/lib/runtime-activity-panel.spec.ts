import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeActivityCensus } from '@rusty-view/transport';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';

import { RuntimeActivityPanelComponent } from './runtime-activity-panel';
import { TopMenuComponent } from './top-menu';

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
    expect(host.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(host.textContent).toContain('model configuration config-gpt-test');
    expect(host.textContent).toContain('model gpt-test');
    expect(host.textContent).toContain('endpoint endpoint-openai');
    expect(host.textContent).toContain('legacy provider alias old-main');

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

  it('opens the Sessions emergency control for the applicable activity session', async () => {
    const fixture = await createPanel({
      activityCensus: signal(activityCensus()),
      refreshActivities: vi.fn(async () => true),
      stale: false,
      error: null,
    });
    const activityHost = fixture.nativeElement as HTMLElement;
    const control = activityHost.querySelector<HTMLButtonElement>(
      '[data-testid="activity-stop-controls"]',
    );
    if (control === null) throw new Error('stop controls button missing');

    control.click();
    fixture.detectChanges();

    const menuFixture = TestBed.createComponent(TopMenuComponent);
    menuFixture.detectChanges();
    await menuFixture.whenStable();
    menuFixture.detectChanges();
    const menuHost = menuFixture.nativeElement as HTMLElement;
    const target = menuHost.querySelector<HTMLElement>(
      '[data-testid="session-control-target"]',
    );
    const pause = menuHost.querySelector<HTMLButtonElement>(
      '[data-testid="session-pause-runtime"][data-session-id="session-1"]',
    );

    expect(
      menuHost.querySelector('[data-testid="top-menu-panel-sessions"]'),
    ).not.toBeNull();
    expect(target?.dataset['sessionId']).toBe('session-1');
    expect(pause).not.toBeNull();
    expect(
      menuHost.querySelector('[data-testid="top-menu-panel-service"]'),
    ).toBeNull();

    menuFixture.destroy();
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
    imports: [RuntimeActivityPanelComponent, TopMenuComponent],
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
          refresh: vi.fn(async () => undefined),
          error: () => null,
          saving: () => false,
          runtimePauseResult: () => null,
          runtimeResumeResult: () => null,
          pauseForSession: () => undefined,
          runtimeSession: () => undefined,
          controlCapabilityState: () => 'available',
        },
      },
      {
        provide: ChatStore,
        useValue: {
          allSessions: () => [
            {
              session_id: 'another-session',
              profile_id: 'profile-1',
              agent_id: 'agent-1',
              title: 'Another session',
              status: 'active',
              created_at: '2026-07-23T00:00:00Z',
              updated_at: '2026-07-23T00:00:01Z',
              message_count: 1,
            },
          ],
          activeSessionId: () => 'another-session',
          selectSession: vi.fn(async () => undefined),
          viewHistoricalSession: vi.fn(async () => undefined),
          refreshSessions: vi.fn(async () => undefined),
          loadProviderRequestDebugDetail: vi.fn(async () => ({})),
          loadToolCallDebugDetail: vi.fn(async () => ({})),
          commands: () => [],
          rawEvents: () => [],
          projection: () => ({ toolCalls: [] }),
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
      {
        ...activity('provider:1', 'provider_request', 'dispatch:1'),
        activity: {
          ...activity('provider:1', 'provider_request', 'dispatch:1').activity,
          modelConfigId: 'config-gpt-test',
          endpointId: 'endpoint-openai',
          model: 'gpt-test',
          providerAlias: 'old-main',
        },
      },
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
      active: 3,
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
