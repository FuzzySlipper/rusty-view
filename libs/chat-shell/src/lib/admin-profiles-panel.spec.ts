import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type AdminControlResponse,
  type AdminProfileRegistryDiagnostics,
  type AdminProfileRegistryRecord,
  type ApiCapabilityDescriptor,
  type CreateAdminProfileRequest,
  type CreatedServiceProfile,
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
    adminModelProviders: async () => null,
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
    createAdminProfile: vi.fn(
      async (
        request: CreateAdminProfileRequest,
      ): Promise<AdminControlResponse<CreatedServiceProfile>> => ({
        command: {
          name: 'create_profile',
          target: { profileId: request.profileId },
          requestId: 'req',
        },
        outcome: {
          status: 'completed',
          summary: `profile ${request.profileId} created`,
          result: {
            profileId: request.profileId,
            agentId: request.profileId,
            sessionId: `${request.profileId}-session`,
            implementationId: `${request.profileId}-brain`,
            profilePath: '/tmp/profile.json',
            runtimeConfigPath: '/tmp/service.json',
            applyResult: {
              brainsRegistered: 1,
              brainsAlreadyPresent: 0,
              sessionsCreated: 1,
              sessionsAlreadyPresent: 0,
              sessionsReactivated: 0,
              sessionsMissing: 0,
              scheduledJobsRegistered: 0,
            },
            derivedRuntimeActions: [
              { refKind: 'brain', refId: `${request.profileId}-brain` },
              { refKind: 'session', refId: `${request.profileId}-session` },
              {
                refKind: 'profile_mcp_config',
                refId: `${request.profileId}-mcp`,
              },
            ],
          },
        },
        audit: { started: true, terminal: true },
        observation: {},
      }),
    ),
    planAdminProfileRegistryUpdate: vi.fn(async () => ({
      ok: true,
      profileId: 'field-prime',
      kind: 'update',
      mode: 'plan',
      expectedRevision: 3,
      current: { profileId: 'field-prime', revision: 3 },
      next: { profileId: 'field-prime', revision: 4, displayName: 'Updated' },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true as const,
        profileFilesUnchanged: true as const,
        serviceConfigUnchanged: true as const,
        runtimeRebuildRecommended: false,
        lifecycleEffects: 'none' as const,
      },
    })),
    applyAdminProfileRegistryUpdate: vi.fn(async () => ({
      ok: true,
      profileId: 'field-prime',
      kind: 'update',
      mode: 'apply',
      expectedRevision: 3,
      current: { profileId: 'field-prime', revision: 3 },
      next: { profileId: 'field-prime', revision: 4 },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true as const,
        profileFilesUnchanged: true as const,
        serviceConfigUnchanged: true as const,
        runtimeRebuildRecommended: false,
        lifecycleEffects: 'none' as const,
      },
      applied: true as const,
      record: { profileId: 'field-prime', revision: 4, displayName: 'Updated' },
    })),
    planAdminProfileRegistryLifecycle: vi.fn(async () => ({
      ok: true,
      profileId: 'field-prime',
      kind: 'lifecycle',
      mode: 'plan',
      expectedRevision: 3,
      current: {
        profileId: 'field-prime',
        revision: 3,
        lifecycleStatus: 'active',
      },
      next: {
        profileId: 'field-prime',
        revision: 4,
        lifecycleStatus: 'paused',
      },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true as const,
        profileFilesUnchanged: true as const,
        serviceConfigUnchanged: true as const,
        runtimeRebuildRecommended: true,
        lifecycleEffects:
          'archive_active_sessions_and_unregister_brain' as const,
      },
    })),
    applyAdminProfileRegistryLifecycle: vi.fn(async () => ({
      ok: true,
      profileId: 'field-prime',
      kind: 'lifecycle',
      mode: 'apply',
      expectedRevision: 3,
      current: {
        profileId: 'field-prime',
        revision: 3,
        lifecycleStatus: 'active',
      },
      next: {
        profileId: 'field-prime',
        revision: 4,
        lifecycleStatus: 'paused',
      },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true as const,
        profileFilesUnchanged: true as const,
        serviceConfigUnchanged: true as const,
        runtimeRebuildRecommended: true,
        lifecycleEffects:
          'archive_active_sessions_and_unregister_brain' as const,
      },
      applied: true as const,
      record: {
        profileId: 'field-prime',
        revision: 4,
        lifecycleStatus: 'paused',
      },
      effects: {
        sessionsArchived: [],
        brainHandle: { action: 'already_absent' },
      },
    })),
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

  it('renders the runtime-graph impact preview grouped by ref kind', async () => {
    const profileDiagnostics: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-26T00:00:00Z',
      records: [
        {
          source: 'registry',
          profileId: 'graph-prime',
          lifecycleStatus: 'active',
          activeRuntimeRefs: [
            {
              refKind: 'brain',
              refId: 'graph-prime-brain',
              status: 'active',
              metadataJson: null,
            },
            {
              refKind: 'session',
              refId: 'graph-prime-session',
              status: 'idle',
              metadataJson: null,
            },
            {
              refKind: 'profile_mcp_config',
              refId: 'graph-prime-mcp',
              status: 'configured',
              metadataJson: null,
            },
          ],
          sourceAssetRefs: [],
          sourceAssetStatuses: [],
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
    const preview =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__preview',
      )?.textContent ?? '';

    expect(preview).toContain('Runtime graph impact (read-only)');
    // Groups are labeled and refs rendered with their id and status.
    expect(preview).toContain('Brains');
    expect(preview).toContain('graph-prime-brain');
    expect(preview).toContain('Sessions');
    expect(preview).toContain('graph-prime-session (idle)');
    expect(preview).toContain('MCP bindings');
    expect(preview).toContain('graph-prime-mcp');
    // Points to the export plan for the full snapshot.
    expect(preview).toContain('runtime-plan.json');
  });

  it('shows an empty runtime-graph preview for a file_fallback profile', async () => {
    const profileDiagnostics: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-26T00:00:00Z',
      records: [
        {
          source: 'file_fallback',
          profileId: 'file-only',
          lifecycleStatus: 'active',
          activeRuntimeRefs: [],
          sourceAssetRefs: [],
          sourceAssetStatuses: [],
          diagnostics: [],
          fallbackStatus: 'file_backed_fallback',
        },
      ],
      registryCount: 0,
      fileFallbackCount: 1,
      driftCount: 0,
      missingAssetCount: 0,
      diagnostics: [],
    };
    const fixture = await createPanel(
      LANDED_PROFILE_CONTROL_CAPABILITY_IDS,
      profileDiagnostics,
    );
    const preview =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__preview',
      )?.textContent ?? '';

    expect(preview).toContain('no derived runtime refs');
  });

  it('surfaces the planned runtime graph from the create flow', async () => {
    const fixture = await createPanel(LANDED_PROFILE_CONTROL_CAPABILITY_IDS);
    const adminStore = TestBed.inject(AdminStore);
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'profileId',
        event: { target: { value: string } },
      ): void;
      createProfile(): void;
    };

    component.updateText('profileId', { target: { value: 'planned-prime' } });
    fixture.detectChanges();
    await adminStore.createProfile({
      profileId: 'planned-prime',
      reason: 'test',
    });
    fixture.detectChanges();

    const preview =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__create-preview',
      )?.textContent ?? '';

    expect(preview).toContain('Planned runtime graph');
    expect(preview).toContain('planned-prime-brain');
    expect(preview).toContain('planned-prime-session');
    expect(preview).toContain('planned-prime-mcp');
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

  it('creates a minimal profile using backend-owned defaults (omits modelConfig)', async () => {
    const fixture = await createPanel(LANDED_PROFILE_CONTROL_CAPABILITY_IDS);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminProfile: { mock: { calls: [CreateAdminProfileRequest][] } };
    };
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'profileId',
        event: { target: { value: string } },
      ): void;
      createProfile(): void;
    };

    // Default path: only a profile id is provided. The model override toggle
    // stays off so the backend applies official registry defaults.
    component.updateText('profileId', {
      target: { value: 'minimal-prime' },
    });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.profileId).toBe('minimal-prime');
    expect(request).not.toHaveProperty('modelConfig');
    expect(request).not.toHaveProperty('kind');
  });

  it('sends kind only when the user explicitly selects a session kind', async () => {
    const fixture = await createPanel(LANDED_PROFILE_CONTROL_CAPABILITY_IDS);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminProfile: { mock: { calls: [CreateAdminProfileRequest][] } };
    };
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'profileId',
        event: { target: { value: string } },
      ): void;
      updateKind(event: { target: { value: string } }): void;
      createProfile(): void;
    };

    component.updateText('profileId', { target: { value: 'kind-prime' } });
    component.updateKind({ target: { value: 'worker' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.kind).toBe('worker');
    expect(request).not.toHaveProperty('modelConfig');
  });

  it('sends providerAlias when the user selects a reusable provider', async () => {
    const fixture = await createPanel(LANDED_PROFILE_CONTROL_CAPABILITY_IDS);
    const transport = TestBed.inject(ChatTransport) as unknown as {
      createAdminProfile: { mock: { calls: [CreateAdminProfileRequest][] } };
    };
    const component = fixture.componentInstance as unknown as {
      updateText(
        field: 'profileId' | 'providerAlias',
        event: { target: { value: string } },
      ): void;
      createProfile(): void;
    };

    component.updateText('profileId', { target: { value: 'alias-prime' } });
    component.updateText('providerAlias', { target: { value: 'default' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.providerAlias).toBe('default');
    expect(request).not.toHaveProperty('modelConfig');
  });

  it('plans a registry field update for a registry-backed profile', async () => {
    const profileDiagnostics: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-27T00:00:00Z',
      records: [
        {
          source: 'registry',
          profileId: 'field-prime',
          lifecycleStatus: 'active',
          revision: 3,
          displayName: 'Field Prime',
          activeRuntimeRefs: [],
          sourceAssetRefs: [],
          sourceAssetStatuses: [],
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
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryUpdate: {
        mock: { calls: unknown[] };
      };
    };
    const component = fixture.componentInstance as unknown as {
      startRegistryEdit(record: AdminProfileRegistryRecord): void;
      updateRegistryEditText(
        field: 'displayName',
        event: { target: { value: string } },
      ): void;
      planRegistryUpdate(record: AdminProfileRegistryRecord): void;
    };
    const records = TestBed.inject(AdminStore).registryRecords();
    const record = records.find((entry) => entry.profileId === 'field-prime');
    if (record === undefined) {
      throw new Error('field-prime registry record not found');
    }

    component.startRegistryEdit(record);
    component.updateRegistryEditText('displayName', {
      target: { value: 'Updated Name' },
    });
    fixture.detectChanges();
    component.planRegistryUpdate(record);
    await fixture.whenStable();

    expect(transport.planAdminProfileRegistryUpdate.mock.calls).toHaveLength(1);
  });

  it('blocks registry edits for a file-backed fallback profile', async () => {
    const profileDiagnostics: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-27T00:00:00Z',
      records: [
        {
          source: 'file_fallback',
          profileId: 'file-only',
          lifecycleStatus: 'active',
          activeRuntimeRefs: [],
          sourceAssetRefs: [],
          sourceAssetStatuses: [],
          diagnostics: [],
          fallbackStatus: 'file_backed_fallback',
        },
      ],
      registryCount: 0,
      fileFallbackCount: 1,
      driftCount: 0,
      missingAssetCount: 0,
      diagnostics: [],
    };
    const fixture = await createPanel(
      LANDED_PROFILE_CONTROL_CAPABILITY_IDS,
      profileDiagnostics,
    );
    const records = TestBed.inject(AdminStore).registryRecords();
    const record = records.find((entry) => entry.profileId === 'file-only');
    if (record === undefined) {
      throw new Error('file-only registry record not found');
    }
    const component = fixture.componentInstance as unknown as {
      isRegistryEditable(record: AdminProfileRegistryRecord): boolean;
      registryEditBlockReason(record: AdminProfileRegistryRecord): string;
    };

    expect(component.isRegistryEditable(record)).toBe(false);
    expect(component.registryEditBlockReason(record)).toContain(
      'Import this file-backed profile',
    );
  });

  it('clears defaultSessionKind when the clear option is selected', async () => {
    const profileDiagnostics: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-27T00:00:00Z',
      records: [
        {
          source: 'registry',
          profileId: 'kind-prime',
          lifecycleStatus: 'active',
          revision: 2,
          defaultSessionKind: 'worker',
          activeRuntimeRefs: [],
          sourceAssetRefs: [],
          sourceAssetStatuses: [],
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
    const transport = TestBed.inject(ChatTransport) as unknown as {
      applyAdminProfileRegistryUpdate: {
        mock: { calls: unknown[] };
      };
    };
    const records = TestBed.inject(AdminStore).registryRecords();
    const record = records.find((entry) => entry.profileId === 'kind-prime');
    if (record === undefined) {
      throw new Error('kind-prime registry record not found');
    }
    const component = fixture.componentInstance as unknown as {
      startRegistryEdit(record: AdminProfileRegistryRecord): void;
      updateRegistryEditKind(event: { target: { value: string } }): void;
      applyRegistryUpdate(record: AdminProfileRegistryRecord): void;
    };

    component.startRegistryEdit(record);
    component.updateRegistryEditKind({ target: { value: '__clear__' } });
    fixture.detectChanges();
    component.applyRegistryUpdate(record);
    await fixture.whenStable();

    const applyMock = transport.applyAdminProfileRegistryUpdate;
    const lastCall = (applyMock.mock.calls[applyMock.mock.calls.length - 1] ??
      undefined) as
      | [string, { defaultSessionKind?: string | null }]
      | undefined;
    if (lastCall === undefined) {
      throw new Error('applyAdminProfileRegistryUpdate was not called');
    }
    expect(lastCall[1].defaultSessionKind).toBeNull();
  });

  it('shows the planned runtime graph impact before applying a lifecycle transition', async () => {
    const profileDiagnostics: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-27T00:00:00Z',
      records: [
        {
          source: 'registry',
          profileId: 'life-prime',
          lifecycleStatus: 'active',
          revision: 5,
          activeRuntimeRefs: [
            {
              refKind: 'session',
              refId: 'life-prime-session',
              status: 'active',
              metadataJson: null,
            },
          ],
          sourceAssetRefs: [],
          sourceAssetStatuses: [],
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
    // Override the lifecycle plan mock to return a next record with disabled refs.
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryLifecycle: (
        profileId: string,
        request: { expectedRevision: number; lifecycleStatus: string },
      ) => Promise<{
        profileId: string;
        next: {
          activeRuntimeRefs: {
            refKind: string;
            refId: string;
            status: string;
          }[];
        };
        implications: { lifecycleEffects: string };
      }>;
    };
    transport.planAdminProfileRegistryLifecycle = async () => ({
      ok: true,
      profileId: 'life-prime',
      kind: 'lifecycle',
      mode: 'plan',
      expectedRevision: 5,
      current: { profileId: 'life-prime', revision: 5 },
      next: {
        profileId: 'life-prime',
        revision: 5,
        activeRuntimeRefs: [
          {
            refKind: 'session',
            refId: 'life-prime-session',
            status: 'paused',
          },
        ],
      },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true as const,
        profileFilesUnchanged: true as const,
        serviceConfigUnchanged: true as const,
        runtimeRebuildRecommended: true,
        lifecycleEffects:
          'archive_active_sessions_and_unregister_brain' as const,
      },
    });
    const records = TestBed.inject(AdminStore).registryRecords();
    const record = records.find((entry) => entry.profileId === 'life-prime');
    if (record === undefined) {
      throw new Error('life-prime registry record not found');
    }
    const component = fixture.componentInstance as unknown as {
      startLifecycleTransition(record: AdminProfileRegistryRecord): void;
      planLifecycleTransition(record: AdminProfileRegistryRecord): void;
    };

    component.startLifecycleTransition(record);
    fixture.detectChanges();
    component.planLifecycleTransition(record);
    await fixture.whenStable();
    fixture.detectChanges();

    const preview =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__plan-preview',
      )?.textContent ?? '';
    expect(preview).toContain('Planned runtime graph after transition');
    expect(preview).toContain('life-prime-session (paused)');
  });
});

/**
 * Pull the most recent createAdminProfile request off a vitest mock. Throws
 * when the spy was never called so the failing assertion is obvious.
 */
function lastCreateRequest(spy: {
  mock: { calls: [CreateAdminProfileRequest][] };
}): CreateAdminProfileRequest {
  const calls = spy.mock.calls;
  const last = calls[calls.length - 1];
  if (last === undefined) {
    throw new Error('createAdminProfile was never called');
  }
  return last[0];
}
