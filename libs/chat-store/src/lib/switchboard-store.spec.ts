import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatTransport,
  ChatTransportError,
  type CoordinationRouteWriteRequest,
} from '@rusty-view/transport';
import { SwitchboardStore } from './switchboard-store';

describe('SwitchboardStore', () => {
  it('loads one role-bound directory, binding catalog, and route list', async () => {
    const transport = transportMock();
    TestBed.configureTestingModule({
      providers: [
        SwitchboardStore,
        { provide: ChatTransport, useValue: transport },
      ],
    });
    const store = TestBed.inject(SwitchboardStore);

    expect(await store.refresh()).toBe(true);

    expect(store.deploymentRole()).toBe('debug');
    expect(store.rows()[0]?.address).toBe('@reviewer');
    expect(store.targetOptions()[0]?.target).toMatchObject({
      type: 'direct_brain',
      agentId: 'reviewer-agent',
      sessionId: 'reviewer-session',
    });
    expect(transport.coordinationRoutes).toHaveBeenCalledWith('debug');
  });

  it('surfaces stale-revision conflicts and preserves the refresh path', async () => {
    const transport = transportMock();
    transport.coordinationUpdateRoute.mockRejectedValueOnce(
      new ChatTransportError({
        code: 'http_error',
        message: 'agent route revision mismatch',
        statusCode: 409,
        apiError: {
          code: 'conflict',
          reason_code: 'agent_route_revision_mismatch',
          message: 'agent route revision mismatch',
          retryable: false,
        },
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        SwitchboardStore,
        { provide: ChatTransport, useValue: transport },
      ],
    });
    const store = TestBed.inject(SwitchboardStore);
    await store.refresh();

    const saved = await store.updateRoute('reviewer', routeWrite());

    expect(saved).toBe(false);
    expect(store.error()).toContain('agent_route_revision_mismatch');
    expect(store.rows()[0]?.revision).toBe(7);
    expect(await store.refresh()).toBe(true);
    expect(store.error()).toBeNull();
  });
});

function routeWrite(): CoordinationRouteWriteRequest {
  return {
    routeKey: 'reviewer',
    label: 'Reviewer',
    enabled: true,
    target: {
      type: 'direct_brain',
      agentId: 'reviewer-agent',
      sessionId: 'reviewer-session',
    },
    expectedRevision: 7,
  };
}

function transportMock() {
  return {
    getConfig: vi.fn(() => ({ baseUrl: 'http://localhost:9348' })),
    coordinationAgentDirectory: vi.fn(async () => ({
      deploymentRole: 'debug' as const,
      agents: [
        {
          agentId: 'reviewer-agent',
          sessionId: 'reviewer-session',
          profileId: 'reviewer-profile',
          displayLabel: 'Reviewer',
          sessionKind: 'full' as const,
          sessionStatus: 'idle' as const,
          runtimeKind: 'direct_brain' as const,
          routable: true,
        },
      ],
    })),
    coordinationRoutes: vi.fn(async () => ({
      deploymentRole: 'debug' as const,
      routes: [
        {
          address: '@reviewer',
          routable: true,
          resolvedTarget: {
            agentId: 'reviewer-agent',
            sessionId: 'reviewer-session',
            profileId: 'reviewer-profile',
            displayLabel: 'Reviewer',
            runtimeKind: 'direct_brain' as const,
          },
          route: {
            routeKey: 'reviewer',
            label: 'Reviewer',
            enabled: true,
            target: {
              type: 'direct_brain' as const,
              agentId: 'reviewer-agent',
              sessionId: 'reviewer-session',
            },
            requiredRuntimeKind: 'direct_brain' as const,
            revision: 7,
            createdAt: '2026-07-21T00:00:00Z',
            updatedAt: '2026-07-21T00:00:00Z',
          },
        },
      ],
    })),
    coordinationCreateRoute: vi.fn(),
    coordinationUpdateRoute: vi.fn(),
    coordinationDeleteRoute: vi.fn(),
    coordinationResolveAddress: vi.fn(),
    coordinationTestRoute: vi.fn(),
    coordinationStartRound: vi.fn(),
    coordinationRound: vi.fn(),
    external: {
      listBindings: vi.fn(async () => ({ bindings: [] })),
    },
  };
}
