import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type AdminProfileRegistryDiagnostics,
  type ApiCapabilityDescriptor,
  type ProfileBundleExportPlan,
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

function makeTransport(
  capabilityIds: readonly string[],
  profileDiagnostics?: AdminProfileRegistryDiagnostics | null,
  exportPlan?: ProfileBundleExportPlan | null,
): ChatTransport {
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
    adminProfileDiagnostics: async () => profileDiagnostics ?? null,
    adminProfileExportPlan: async () =>
      exportPlan ?? {
        profileId: 'field-prime',
        generatedAt: '2026-06-26T00:00:00Z',
        source: 'registry',
        lifecycleStatus: 'active',
        fallbackStatus: 'registry_authoritative',
        bundleRootName: 'field-prime-profile-bundle',
        entries: [],
        activeDbStateEntries: [],
        fileAssetEntries: [],
        optionalEntries: [],
        diagnostics: [],
        warnings: [],
      },
  } as unknown as ChatTransport;
}

async function createPanel(
  capabilityIds: readonly string[],
  profileDiagnostics?: AdminProfileRegistryDiagnostics | null,
  exportPlan?: ProfileBundleExportPlan | null,
) {
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
      {
        provide: ChatTransport,
        useValue: makeTransport(capabilityIds, profileDiagnostics, exportPlan),
      },
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

  it('shows profile registry records with DB state separate from file assets', async () => {
    const profileDiagnostics: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-26T00:00:00Z',
      records: [
        {
          source: 'registry',
          profileId: 'field-prime',
          lifecycleStatus: 'active',
          displayName: 'Field Prime',
          revision: 3,
          defaultSessionKind: 'full',
          agentId: 'field-prime',
          ownerId: 'operator',
          activeRuntimeRefs: [
            {
              refKind: 'session',
              refId: 'field-prime-session',
              status: 'idle',
              metadataJson: null,
            },
          ],
          sourceAssetRefs: [],
          sourceAssetStatuses: [
            {
              assetKind: 'soul_md',
              path: '/profiles/field-prime/soul.md',
              contentHash: 'sha256:abc',
              currentContentHash: 'sha256:abc',
              status: 'tracked',
            },
          ],
          diagnostics: [],
          fallbackStatus: 'registry_authoritative',
        },
      ],
      registryCount: 1,
      fileFallbackCount: 0,
      driftCount: 0,
      missingAssetCount: 0,
      diagnostics: [],
    };
    const fixture = await createPanel(
      LANDED_PROFILE_CONTROL_CAPABILITY_IDS,
      profileDiagnostics,
    );
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__registry',
      )?.textContent ?? '';

    // DB-active fields and file assets are rendered in separate groups.
    expect(text).toContain('field-prime');
    expect(text).toContain('Active registry fields (DB state)');
    expect(text).toContain('File assets (soul.md / memory.md / templates)');
    expect(text).toContain('DB registry');
    expect(text).toContain('soul_md');
    expect(text).toContain('tracked');
    // Raw prompt content is not exposed; only the asset kind and status.
    expect(text).not.toContain('sha256:abc');
  });

  it('requests and renders a profile bundle export plan', async () => {
    const exportPlan: ProfileBundleExportPlan = {
      profileId: 'field-prime',
      generatedAt: '2026-06-26T00:00:00Z',
      source: 'registry',
      lifecycleStatus: 'active',
      fallbackStatus: 'registry_authoritative',
      bundleRootName: 'field-prime-profile-bundle',
      entries: [
        {
          targetPath: 'profile.yaml',
          kind: 'generated_profile_yaml',
          source: 'registry_active_state',
          notes: [],
        },
        {
          targetPath: 'soul.md',
          kind: 'copy_file_asset',
          source: 'file_asset',
          originPath: '/profiles/field-prime/soul.md',
          assetStatus: 'tracked',
          notes: [],
        },
      ],
      activeDbStateEntries: ['profile.yaml'],
      fileAssetEntries: ['soul.md'],
      optionalEntries: [],
      diagnostics: [],
      warnings: [],
    };
    const fixture = await createPanel(
      LANDED_PROFILE_CONTROL_CAPABILITY_IDS,
      null,
      exportPlan,
    );
    const component = fixture.componentInstance as unknown as {
      requestExportPlan(profileId: string): void;
    };

    component.requestExportPlan('field-prime');
    await fixture.whenStable();
    fixture.detectChanges();

    const exportText =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__export-plan',
      )?.textContent ?? '';

    expect(exportText).toContain('field-prime');
    expect(exportText).toContain('profile.yaml');
    expect(exportText).toContain('soul.md');
    expect(exportText).toContain('active DB state: 1');
    expect(exportText).toContain('file assets: 1');
  });
});
