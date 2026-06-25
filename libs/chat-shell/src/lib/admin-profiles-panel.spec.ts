import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type ApiCapabilityDescriptor,
} from '@rusty-view/transport';

import { AdminProfilesPanelComponent } from './admin-profiles-panel';

const LANDED_PROFILE_CONTROL_CAPABILITY_IDS = [
  'admin.control.profiles.create',
  'admin.control.config.reload',
  'admin.control.mcp.reload',
  'admin.control.profiles.read',
  'admin.control.profiles.update.plan',
  'admin.control.profiles.update.apply',
  'admin.control.sessions.rebuild_runtime.plan',
  'admin.control.sessions.rebuild_runtime.apply',
  'admin.control.profiles.rebuild_brain.plan',
  'admin.control.profiles.rebuild_brain.apply',
] as const;

function capability(id: string): ApiCapabilityDescriptor {
  return {
    id,
    method: 'POST',
    path_template: `/test/${id}`,
    description: id,
    auth: 'admin',
    mutation: 'control',
    stability: 'experimental',
    tags: [],
    public: false,
  };
}

function makeTransport(capabilityIds: readonly string[]): ChatTransport {
  return {
    adminDiagnostics: async () => ({
      overview: {
        generatedAt: '2026-06-25T00:00:00Z',
        health: 'ok',
        degraded: false,
        reasonCodes: [],
        summary: {
          sessions: 0,
          activeSessions: 0,
          idleSessions: 0,
          archivedSessions: 0,
          delegatedSessions: 0,
          blockedDelegations: 0,
          pendingQueueItems: 0,
          expiredQueueItems: 0,
          toolErrors: 0,
          recentErrors: 0,
        },
        runtime: {
          brainModules: [],
          sessions: [],
          delegatedSessions: [],
          runtimePauses: [],
        },
      },
      health: {},
    }),
    adminSessions: async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    }),
    adminAgents: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    adminMcpSurfaces: async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    }),
    adminConfigValidation: async () => null,
    adminCapabilities: async () => ({
      schema_version: 1,
      slash_commands: [],
      capabilities: capabilityIds.map(capability),
    }),
  } as unknown as ChatTransport;
}

async function createPanel(capabilityIds: readonly string[]) {
  await TestBed.configureTestingModule({
    imports: [AdminProfilesPanelComponent],
    providers: [
      AdminStore,
      {
        provide: ChatStore,
        useValue: {
          refreshSessions: vi.fn(),
        },
      },
      { provide: ChatTransport, useValue: makeTransport(capabilityIds) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminProfilesPanelComponent);
  fixture.detectChanges();
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

describe('AdminProfilesPanelComponent', () => {
  it('reflects landed profile update and rebuild capabilities', async () => {
    const fixture = await createPanel(LANDED_PROFILE_CONTROL_CAPABILITY_IDS);
    const capabilityText =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__capabilities',
      )?.textContent ?? '';

    expect(capabilityText).toContain('Profile file edits');
    expect(capabilityText).toContain('Model/provider changes');
    expect(capabilityText).toContain('guarded rebuild available');
    expect(capabilityText).not.toContain('backend API needed');
  });
});
