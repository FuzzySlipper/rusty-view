import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  SwitchboardStore,
  buildSwitchboardTargetOptions,
  projectSwitchboardRouteRows,
} from '@rusty-view/chat-store';
import type {
  AgentDirectoryEntry,
  AgentRouteResolution,
} from '@rusty-view/protocol';
import { AdminSwitchboardPanelComponent } from './admin-switchboard-panel';

describe('AdminSwitchboardPanelComponent', () => {
  it('shows deployment identity and concrete duplicate-session details', async () => {
    const store = switchboardMock();
    await TestBed.configureTestingModule({
      imports: [AdminSwitchboardPanelComponent],
      providers: [{ provide: SwitchboardStore, useValue: store }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminSwitchboardPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('debug');
    expect(text).toContain('http://localhost:9348');
    expect(text).toContain('@reviewer');
    expect(text).toContain('agent reviewer-a');
    expect(text).toContain('session session-a');
    expect(text).toContain('duplicate profile');
  });

  it('edits and saves using the frozen route revision', async () => {
    const store = switchboardMock();
    await TestBed.configureTestingModule({
      imports: [AdminSwitchboardPanelComponent],
      providers: [{ provide: SwitchboardStore, useValue: store }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminSwitchboardPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const edit = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Edit',
    ) as HTMLButtonElement | undefined;
    edit?.click();
    fixture.detectChanges();
    const save = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) =>
        button.textContent?.trim() === 'Save route',
    ) as HTMLButtonElement | undefined;
    expect(save?.disabled).toBe(false);
    save?.click();
    await fixture.whenStable();

    expect(store.updateRoute).toHaveBeenCalledWith(
      'reviewer',
      expect.objectContaining({
        routeKey: 'reviewer',
        expectedRevision: 7,
        target: {
          type: 'direct_brain',
          agentId: 'reviewer-a',
          sessionId: 'session-a',
        },
      }),
    );
  });
});

function switchboardMock() {
  const agents: readonly AgentDirectoryEntry[] = [
    agent('reviewer-a', 'session-a'),
    agent('reviewer-b', 'session-b'),
  ];
  const resolutions: readonly AgentRouteResolution[] = [
    {
      address: '@reviewer',
      routable: true,
      resolvedTarget: {
        agentId: 'reviewer-a',
        sessionId: 'session-a',
        profileId: 'reviewer-profile',
        displayLabel: 'Reviewer',
        runtimeKind: 'direct_brain',
      },
      route: {
        routeKey: 'reviewer',
        label: 'Reviewer',
        enabled: true,
        target: {
          type: 'direct_brain',
          agentId: 'reviewer-a',
          sessionId: 'session-a',
        },
        requiredRuntimeKind: 'direct_brain',
        revision: 7,
        createdAt: '2026-07-21T00:00:00Z',
        updatedAt: '2026-07-21T00:00:00Z',
      },
    },
  ];
  const deploymentRole = signal<'debug'>('debug');
  const saving = signal(false);
  const loading = signal(false);
  const error = signal<string | null>(null);
  const lastAction = signal(null);
  const agentSignal = signal(agents);
  const bindingSignal = signal([]);
  const resolutionSignal = signal(resolutions);
  const targetOptions = computed(() =>
    buildSwitchboardTargetOptions(agentSignal(), bindingSignal()),
  );
  const rows = computed(() => projectSwitchboardRouteRows(resolutionSignal()));
  return {
    deploymentRole,
    serviceBaseUrl: 'http://localhost:9348',
    agents: agentSignal,
    bindings: bindingSignal,
    resolutions: resolutionSignal,
    loading,
    saving,
    error,
    lastAction,
    targetOptions,
    rows,
    refresh: vi.fn(async () => true),
    createRoute: vi.fn(async () => true),
    updateRoute: vi.fn(async () => true),
    deleteRoute: vi.fn(async () => true),
    resolveAddress: vi.fn(async () => true),
    testDelivery: vi.fn(async () => true),
    testRound: vi.fn(async () => true),
  };
}

function agent(agentId: string, sessionId: string): AgentDirectoryEntry {
  return {
    agentId,
    sessionId,
    profileId: 'reviewer-profile',
    displayLabel: 'Reviewer',
    sessionKind: 'full',
    sessionStatus: 'idle',
    runtimeKind: 'direct_brain',
    routable: true,
  };
}
