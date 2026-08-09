import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  AdminStore,
  CHAT_STORAGE_ADAPTER,
  ChatStore,
  ExternalAgentStore,
} from '@rusty-view/chat-store';
import type { ChatStorageAdapter, ChatUiState } from '@rusty-view/chat-domain';
import type {
  ExternalAgentBinding,
  ExternalMessageDeliveryPolicy,
} from '@rusty-view/protocol';
import {
  ChatTransport,
  type AdminProfileRegistryRecord,
  type ProfileDeleteRequest,
  type ProfileRegistryRuntimeConfigRequest,
} from '@rusty-view/transport';

type RuntimeConfigSpy = {
  mock: { calls: [string, ProfileRegistryRuntimeConfigRequest][] };
};

type DeleteSpy = {
  mock: { calls: [string, ProfileDeleteRequest][] };
};

class InMemStorage implements ChatStorageAdapter {
  async putSession(): Promise<void> {
    /* noop */
  }
  async putEvents(): Promise<void> {
    /* noop */
  }
  async getEvents(): Promise<never[]> {
    return [];
  }
  async getSessions(): Promise<never[]> {
    return [];
  }
  async clearSession(): Promise<void> {
    /* noop */
  }
  async getUiState(): Promise<ChatUiState | null> {
    return null;
  }
  async setUiState(): Promise<void> {
    /* noop */
  }
}

import { AdminProfileEditComponent } from './admin-profile-edit';
import {
  lastRuntimeConfigRequest,
  makeTransport,
  mcpCatalog,
  registryDiagnostics,
  toolCatalog,
  localToolProfiles,
  type TransportOptions,
} from './admin-profiles.testing';

async function editWindow(
  profileId: string,
  options: TransportOptions = {},
  externalBindings: readonly ExternalAgentBinding[] = [],
) {
  const externalAgentStore = {
    bindings: signal<readonly ExternalAgentBinding[]>(externalBindings),
    refresh: async (): Promise<void> => undefined,
  };
  await TestBed.configureTestingModule({
    imports: [AdminProfileEditComponent],
    providers: [
      AdminStore,
      ChatStore,
      { provide: ExternalAgentStore, useValue: externalAgentStore },
      { provide: CHAT_STORAGE_ADAPTER, useClass: InMemStorage },
      { provide: ChatTransport, useValue: makeTransport(options) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminProfileEditComponent);
  fixture.componentRef.setInput('profileId', profileId);
  fixture.detectChanges();
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

interface EditComponentApi {
  showSection(section: 'fields' | 'lifecycle' | 'prompts' | 'runtime'): void;
  updateRuntimeProviderAlias(event: { target: { value: string } }): void;
  updateRuntimeExternalMessageDeliveryPolicy(event: {
    target: { value: string };
  }): void;
  updateRuntimeLocalToolProfile(event: { target: { value: string } }): void;
  toggleRuntimeCustomTools(): void;
  toggleRuntimeToolset(
    toolsetId: string,
    event: { target: { checked: boolean } },
  ): void;
  toggleRuntimeMcpServer(
    serverId: string,
    event: { target: { checked: boolean } },
  ): void;
  runtimeLocalToolProfileId(): string;
  runtimeExternalMessageDeliveryPolicy(): ExternalMessageDeliveryPolicy;
  runtimeToolsetSelections(): readonly string[];
  planRuntimeConfig(record: AdminProfileRegistryRecord): void;
  applyRuntimeConfig(record: AdminProfileRegistryRecord): void;
  updateContextStrategy(event: { target: { value: string } }): void;
  updateContextDebugVisibility(event: { target: { value: string } }): void;
  toggleContextField(
    field:
      | 'enabled'
      | 'autoCompactionEnabled'
      | 'includeDebugEventsInModelContext',
    event: { target: { checked: boolean } },
  ): void;
  updateContextPercent(
    field:
      | 'compactAtPercent'
      | 'targetPercentAfterCompaction'
      | 'maxContextPercentForWake',
    event: { target: { value: string } },
  ): void;
  updateRegistryEditText(
    field: 'displayName',
    event: { target: { value: string } },
  ): void;
  updateRegistryEditKind(event: { target: { value: string } }): void;
  planRegistryUpdate(record: AdminProfileRegistryRecord): void;
  applyRegistryUpdate(record: AdminProfileRegistryRecord): void;
  planLifecycleTransition(record: AdminProfileRegistryRecord): void;
  updatePromptEditSoul(event: Event): void;
  updatePromptEditMemory(event: Event): void;
  clearPromptEditSoul(): void;
  planPromptEdit(record: AdminProfileRegistryRecord): void;
  applyPromptEdit(record: AdminProfileRegistryRecord): void;
  requestExportPlan(): void;
  openDeleteConfirmationBox(): void;
  updateDeleteConfirmation(event: { target: { value: string } }): void;
  cancelDelete(): void;
  deleteProfile(record: AdminProfileRegistryRecord): Promise<void>;
}

function recordFor(profileId: string): AdminProfileRegistryRecord {
  const record = TestBed.inject(AdminStore)
    .registryRecords()
    .find((entry) => entry.profileId === profileId);
  if (record === undefined) throw new Error(`${profileId} record not found`);
  return record;
}

function buttonByText(
  fixture: { nativeElement: HTMLElement },
  label: string,
): HTMLButtonElement {
  const button = Array.from(
    fixture.nativeElement.querySelectorAll('button'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`${label} button not found`);
  }
  return button;
}

describe('AdminProfileEditComponent', () => {
  it('shows a read-only overview with runtime graph and file assets', async () => {
    const fixture = await editWindow('graph-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'graph-prime',
        revision: 2,
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
        ],
        sourceAssetStatuses: [
          {
            assetKind: 'soul_md',
            path: '/profiles/graph-prime/soul.md',
            contentHash: 'sha256:abc',
            currentContentHash: 'sha256:abc',
            status: 'tracked',
          },
        ],
      }),
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Profile status');
    expect(text).toContain('Technical setup details');
    expect(text).toContain('Agent runtime');
    expect(text).toContain('graph-prime-brain');
    expect(text).toContain('graph-prime-session (idle)');
    expect(text).toContain('soul_md');
    expect(text).toContain('tracked');
    // Raw fingerprints are not exposed.
    expect(text).not.toContain('sha256:abc');
  });

  it('plans a registry field update', async () => {
    const fixture = await editWindow('field-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'field-prime',
        revision: 3,
        displayName: 'Field Prime',
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryUpdate: { mock: { calls: unknown[] } };
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.updateRegistryEditText('displayName', {
      target: { value: 'Updated Name' },
    });
    fixture.detectChanges();
    component.planRegistryUpdate(recordFor('field-prime'));
    await fixture.whenStable();

    expect(transport.planAdminProfileRegistryUpdate.mock.calls).toHaveLength(1);
  });

  it('surfaces an apply-time revision mismatch in the plan diagnostics', async () => {
    const fixture = await editWindow('stale-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'stale-prime',
        revision: 3,
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      applyAdminProfileRegistryUpdate: () => Promise<unknown>;
    };
    transport.applyAdminProfileRegistryUpdate = async () => ({
      ok: false,
      profileId: 'stale-prime',
      kind: 'update',
      mode: 'apply',
      expectedRevision: 3,
      current: { profileId: 'stale-prime', revision: 4 },
      next: { profileId: 'stale-prime', revision: 4 },
      diagnostics: [
        {
          severity: 'error',
          code: 'profile_registry_revision_mismatch',
          path: 'expectedRevision',
          message: 'expected revision 3, found 4',
        },
      ],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: false,
        lifecycleEffects: 'none',
      },
    });
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.applyRegistryUpdate(recordFor('stale-prime'));
    await fixture.whenStable();
    fixture.detectChanges();

    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__diag--error',
      )?.textContent ?? '';
    expect(text).toContain('profile_registry_revision_mismatch');
    expect(text).toContain('expected revision 3, found 4');
  });

  it('clears defaultSessionKind when the clear option is selected', async () => {
    const fixture = await editWindow('kind-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'kind-prime',
        revision: 2,
        defaultSessionKind: 'worker',
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      applyAdminProfileRegistryUpdate: { mock: { calls: unknown[] } };
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.updateRegistryEditKind({ target: { value: '__clear__' } });
    fixture.detectChanges();
    component.applyRegistryUpdate(recordFor('kind-prime'));
    await fixture.whenStable();

    const applyMock = transport.applyAdminProfileRegistryUpdate;
    const lastCall = applyMock.mock.calls[applyMock.mock.calls.length - 1] as
      | [string, { defaultSessionKind?: string | null }]
      | undefined;
    if (lastCall === undefined) throw new Error('apply was not called');
    expect(lastCall[1].defaultSessionKind).toBeNull();
  });

  it('shows the planned runtime graph before applying a lifecycle transition', async () => {
    const fixture = await editWindow('life-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'life-prime',
        revision: 5,
        activeRuntimeRefs: [
          {
            refKind: 'session',
            refId: 'life-prime-session',
            status: 'active',
            metadataJson: null,
          },
        ],
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryLifecycle: () => Promise<unknown>;
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
          { refKind: 'session', refId: 'life-prime-session', status: 'paused' },
        ],
      },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: true,
        lifecycleEffects: 'archive_active_sessions_and_unregister_brain',
      },
    });
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('lifecycle');
    fixture.detectChanges();
    component.planLifecycleTransition(recordFor('life-prime'));
    await fixture.whenStable();
    fixture.detectChanges();

    const preview =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__plan-preview',
      )?.textContent ?? '';
    expect(preview).toContain('Planned runtime graph after transition');
    expect(preview).toContain('life-prime-session (paused)');
  });

  it('plans a prompt edit with both fields set', async () => {
    const fixture = await editWindow('prompt-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'prompt-prime',
        revision: 2,
        promptSoulMarkdown: 'old soul',
        promptMemoryMarkdown: 'old memory',
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryPrompt: { mock: { calls: unknown[][] } };
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('prompts');
    component.updatePromptEditSoul({
      target: { value: 'new soul' },
    } as unknown as Event);
    component.updatePromptEditMemory({
      target: { value: 'new memory' },
    } as unknown as Event);
    fixture.detectChanges();
    component.planPromptEdit(recordFor('prompt-prime'));
    await fixture.whenStable();

    const calls = transport.planAdminProfileRegistryPrompt.mock.calls;
    expect(calls).toHaveLength(1);
    const [profileId, request] = calls[0] as [string, unknown];
    expect(profileId).toBe('prompt-prime');
    expect(request).toMatchObject({
      expectedRevision: 2,
      soulMarkdown: 'new soul',
      memoryMarkdown: 'new memory',
    });
  });

  it('sends null for a prompt field when Clear is clicked', async () => {
    const fixture = await editWindow('clear-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'clear-prime',
        revision: 1,
        promptSoulMarkdown: 'has soul',
        promptMemoryMarkdown: 'has memory',
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      applyAdminProfileRegistryPrompt: { mock: { calls: unknown[][] } };
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('prompts');
    component.clearPromptEditSoul();
    fixture.detectChanges();
    component.applyPromptEdit(recordFor('clear-prime'));
    await fixture.whenStable();

    const calls = transport.applyAdminProfileRegistryPrompt.mock.calls;
    expect(calls).toHaveLength(1);
    const [, request] = calls[0] as [string, unknown];
    expect(request).toHaveProperty('soulMarkdown', null);
    expect('memoryMarkdown' in (request as object)).toBe(false);
  });

  it('preserves empty string as a valid markdown value (not coerced to null)', async () => {
    const fixture = await editWindow('empty-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'empty-prime',
        revision: 1,
        promptSoulMarkdown: 'not empty',
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryPrompt: { mock: { calls: unknown[][] } };
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('prompts');
    component.updatePromptEditSoul({
      target: { value: '' },
    } as unknown as Event);
    fixture.detectChanges();
    component.planPromptEdit(recordFor('empty-prime'));
    await fixture.whenStable();

    const calls = transport.planAdminProfileRegistryPrompt.mock.calls;
    expect(calls).toHaveLength(1);
    const [, request] = calls[0] as [string, unknown];
    expect(request).toMatchObject({ expectedRevision: 1, soulMarkdown: '' });
  });

  it('requests and renders the profile bundle export plan', async () => {
    const fixture = await editWindow('field-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'field-prime',
        revision: 3,
      }),
      exportPlan: {
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
        ],
        activeDbStateEntries: ['profile.yaml'],
        fileAssetEntries: [],
        optionalEntries: [],
        diagnostics: [],
        warnings: [],
      },
    });
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.requestExportPlan();
    await fixture.whenStable();
    fixture.detectChanges();

    const exportText =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__export-plan',
      )?.textContent ?? '';
    expect(exportText).toContain('field-prime');
    expect(exportText).toContain('profile.yaml');
    expect(exportText).toContain('active DB state: 1');
  });

  it('shows MCP binding resolution for the profile and flags fallback/degraded', async () => {
    const fixture = await editWindow('field-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'field-prime',
        revision: 3,
      }),
      mcpCatalog: mcpCatalog(),
    });
    const text = (fixture.nativeElement as HTMLElement).innerHTML;

    expect(text).toContain('MCP Binding Resolution');
    expect(text).toContain('legacy-files');
    expect(text).toContain('env-default');
    expect(text).toContain('compatibility fallback');
    expect(text).toContain('degraded server unreachable');
  });

  // ---- runtime-config edit: provider / tools / MCP (#3742) ----------------

  async function runtimeWindow(profileId = 'rt-prime') {
    const fixture = await editWindow(profileId, {
      profileDiagnostics: registryDiagnostics({
        profileId,
        revision: 5,
        providerAlias: 'default',
        localToolProfileId: 'planner-tools',
        toolPolicy: { requestedToolsets: ['local_code_read'] },
        mcpBindings: [
          {
            serverId: 'den',
            toolProfileKey: 'den-key',
            transport: 'streamable_http',
          },
        ],
      }),
      mcpCatalog: mcpCatalog(),
      toolCatalog: toolCatalog(),
      localToolProfiles: localToolProfiles(),
    });
    const component = fixture.componentInstance as unknown as EditComponentApi;
    component.showSection('runtime');
    fixture.detectChanges();
    return { fixture, component };
  }

  function bindingForProfile(profileId: string): ExternalAgentBinding {
    return {
      bindingId: `${profileId}-binding`,
      runtimeId: `${profileId}-runtime`,
      nativeThreadId: `${profileId}-thread`,
      sessionId: `${profileId}-session`,
      agentId: profileId,
      purpose: 'crew_agent',
      status: 'active',
      cwd: '/home/dev/rusty-view',
      dynamicToolCatalogFingerprint: null,
      effectiveConfigFingerprint: 'config',
      lineage: null,
      messageDeliveryPolicy: 'immediate_steer',
      profileId,
      profilePromptHash: null,
      profilePromptSnapshot: null,
      profileRevision: 5,
      revision: 1,
      createdAt: '2026-07-11T00:00:00Z',
      updatedAt: '2026-07-11T00:00:00Z',
    };
  }

  it('seeds the runtime-config form from the record (#3742)', async () => {
    const { fixture, component } = await runtimeWindow();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    // Provider and local tool profile are seeded as selected values.
    expect(html).toContain('Provider &amp; Tools');
    expect(component.runtimeLocalToolProfileId()).toBe('planner-tools');
  });

  it('edits profile delivery policy and shows existing binding mismatch (#6652)', async () => {
    const profileId = 'rt-prime';
    const fixture = await editWindow(
      profileId,
      {
        profileDiagnostics: registryDiagnostics({
          profileId,
          revision: 5,
          externalMessageDeliveryPolicy: 'immediate_steer',
        }),
      },
      [bindingForProfile(profileId)],
    );
    const component = fixture.componentInstance as unknown as EditComponentApi;
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryRuntimeConfig: RuntimeConfigSpy;
    };

    component.showSection('runtime');
    component.updateRuntimeExternalMessageDeliveryPolicy({
      target: { value: 'serial_next_turn' },
    });
    fixture.detectChanges();

    expect(component.runtimeExternalMessageDeliveryPolicy()).toBe(
      'serial_next_turn',
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('effective immediate_steer');
    expect(text).toContain('differs from profile policy');

    component.planRuntimeConfig(recordFor(profileId));
    await fixture.whenStable();
    fixture.detectChanges();

    const request = lastRuntimeConfigRequest(
      transport.planAdminProfileRegistryRuntimeConfig,
    );
    expect(request.externalMessageDeliveryPolicy).toBe('serial_next_turn');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'external binding replacement recommended true',
    );
  });

  it('prefers a selected local tool profile and omits inline toolPolicy (#3742)', async () => {
    const { fixture, component } = await runtimeWindow();
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryRuntimeConfig: RuntimeConfigSpy;
    };
    component.planRuntimeConfig(recordFor('rt-prime'));
    await fixture.whenStable();

    const request = lastRuntimeConfigRequest(
      transport.planAdminProfileRegistryRuntimeConfig,
    );
    expect(request.expectedRevision).toBe(5);
    expect(request.providerAlias).toBe('default');
    expect(request.localToolProfileId).toBe('planner-tools');
    expect(request).not.toHaveProperty('toolPolicy');
    // MCP untouched, so omitted to preserve current bindings.
    expect(request).not.toHaveProperty('mcpBindings');
  });

  it('sends inline toolPolicy with localToolProfileId:null when the profile is cleared (#3742)', async () => {
    const { fixture, component } = await runtimeWindow();
    const transport = TestBed.inject(ChatTransport) as unknown as {
      applyAdminProfileRegistryRuntimeConfig: RuntimeConfigSpy;
    };
    // Clear the local tool profile, open custom tools, add a toolset.
    component.updateRuntimeLocalToolProfile({ target: { value: '' } });
    component.toggleRuntimeCustomTools();
    component.toggleRuntimeToolset('memory_profile', {
      target: { checked: true },
    });
    fixture.detectChanges();
    component.applyRuntimeConfig(recordFor('rt-prime'));
    await fixture.whenStable();

    const request = lastRuntimeConfigRequest(
      transport.applyAdminProfileRegistryRuntimeConfig,
    );
    expect(request.localToolProfileId).toBeNull();
    expect(request.toolPolicy?.requestedToolsets).toContain('local_code_read');
    expect(request.toolPolicy?.requestedToolsets).toContain('memory_profile');
  });

  it('only sends mcpBindings after the bindings are edited (#3742)', async () => {
    const { fixture, component } = await runtimeWindow();
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryRuntimeConfig: RuntimeConfigSpy;
    };
    // Toggle the seeded server off; bindings become dirty and are sent.
    component.toggleRuntimeMcpServer('den', { target: { checked: false } });
    fixture.detectChanges();
    component.planRuntimeConfig(recordFor('rt-prime'));
    await fixture.whenStable();

    const request = lastRuntimeConfigRequest(
      transport.planAdminProfileRegistryRuntimeConfig,
    );
    expect(request.mcpBindings).toEqual([]);
  });

  it('does not expose manual brain rebuild controls from the runtime tab', async () => {
    const { fixture } = await runtimeWindow();
    const rendered = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(rendered).not.toContain('Brain rebuild');
    expect(rendered).not.toContain('Plan rebuild');
    expect(rendered).not.toContain('Apply rebuild');
  });

  it('requires exact profile id confirmation before hard delete', async () => {
    const fixture = await editWindow('delete-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'delete-prime',
        revision: 5,
      }),
    });
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('lifecycle');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="profile-hard-delete"]',
      ),
    ).toBeNull();

    expect(buttonByText(fixture, 'Delete profile').disabled).toBe(false);
    component.openDeleteConfirmationBox();
    fixture.detectChanges();
    expect(buttonByText(fixture, 'Confirm delete').disabled).toBe(true);

    component.updateDeleteConfirmation({ target: { value: 'wrong' } });
    fixture.detectChanges();
    expect(buttonByText(fixture, 'Confirm delete').disabled).toBe(true);

    component.updateDeleteConfirmation({ target: { value: 'delete-prime' } });
    fixture.detectChanges();
    expect(buttonByText(fixture, 'Confirm delete').disabled).toBe(false);
  });

  it('cancels hard-delete confirmation without calling Crew', async () => {
    const fixture = await editWindow('delete-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'delete-prime',
        revision: 5,
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      deleteAdminProfile: DeleteSpy;
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('lifecycle');
    component.openDeleteConfirmationBox();
    component.updateDeleteConfirmation({ target: { value: 'delete-prime' } });
    fixture.detectChanges();
    component.cancelDelete();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="profile-hard-delete"]',
      ),
    ).toBeNull();
    expect(transport.deleteAdminProfile.mock.calls).toHaveLength(0);
  });

  it('hard-deletes a profile and surfaces purge counts', async () => {
    const fixture = await editWindow('delete-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'delete-prime',
        revision: 5,
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      deleteAdminProfile: DeleteSpy;
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('lifecycle');
    component.openDeleteConfirmationBox();
    component.updateDeleteConfirmation({ target: { value: 'delete-prime' } });
    fixture.detectChanges();
    await component.deleteProfile(recordFor('delete-prime'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(transport.deleteAdminProfile.mock.calls[0]).toEqual([
      'delete-prime',
      {
        reason: 'profile hard-deleted from Rusty View',
        confirmProfileId: 'delete-prime',
      },
    ]);
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('profile hard-delete completed');
    expect(html).toContain('rows deleted 7');
    expect(html).toContain('profile registry deleted true');
    expect(html).toContain('sessions delete-prime-session');
    expect(html).toContain('profile_registry');
  });

  it('disables hard delete when Crew capability is unavailable', async () => {
    const fixture = await editWindow('delete-prime', {
      capabilityIds: [],
      profileDiagnostics: registryDiagnostics({
        profileId: 'delete-prime',
        revision: 5,
      }),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      deleteAdminProfile: DeleteSpy;
    };
    const component = fixture.componentInstance as unknown as EditComponentApi;

    component.showSection('lifecycle');
    component.openDeleteConfirmationBox();
    component.updateDeleteConfirmation({ target: { value: 'delete-prime' } });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'capability missing',
    );
    expect(buttonByText(fixture, 'Confirm delete').disabled).toBe(true);

    await component.deleteProfile(recordFor('delete-prime'));
    await fixture.whenStable();
    expect(transport.deleteAdminProfile.mock.calls).toHaveLength(0);
  });

  // ---- context strategy policy edit (#3849) -------------------------------

  it('renders strategy options from the catalog, not hardcoded ids (#3849)', async () => {
    const { fixture } = await runtimeWindow();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Context strategy');
    // Options come from the backend catalog fixture.
    expect(html).toContain('Recent Window');
    expect(html).toContain('Rolling Summary Compaction');
  });

  it('shows an empty state when the strategy catalog is unavailable (#3849)', async () => {
    const fixture = await editWindow('rt-prime', {
      profileDiagnostics: registryDiagnostics({
        profileId: 'rt-prime',
        revision: 5,
      }),
      contextStrategyCatalog: null,
    });
    const component = fixture.componentInstance as unknown as EditComponentApi;
    component.showSection('runtime');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).innerHTML).toContain(
      'No context strategy catalog available',
    );
  });

  it('omits contextPolicy when the policy is untouched (#3849)', async () => {
    const { fixture, component } = await runtimeWindow();
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryRuntimeConfig: RuntimeConfigSpy;
    };
    component.planRuntimeConfig(recordFor('rt-prime'));
    await fixture.whenStable();

    const request = lastRuntimeConfigRequest(
      transport.planAdminProfileRegistryRuntimeConfig,
    );
    expect(request).not.toHaveProperty('contextPolicy');
  });

  it('sends contextPolicy with camelCase fields once edited (#3849)', async () => {
    const { fixture, component } = await runtimeWindow();
    const transport = TestBed.inject(ChatTransport) as unknown as {
      applyAdminProfileRegistryRuntimeConfig: RuntimeConfigSpy;
    };
    component.updateContextStrategy({
      target: { value: 'rolling_summary_compaction' },
    });
    component.toggleContextField('autoCompactionEnabled', {
      target: { checked: true },
    });
    component.updateContextPercent('compactAtPercent', {
      target: { value: '82' },
    });
    component.updateContextDebugVisibility({ target: { value: 'verbose' } });
    fixture.detectChanges();
    component.applyRuntimeConfig(recordFor('rt-prime'));
    await fixture.whenStable();

    const request = lastRuntimeConfigRequest(
      transport.applyAdminProfileRegistryRuntimeConfig,
    );
    expect(request.contextPolicy).toMatchObject({
      strategyId: 'rolling_summary_compaction',
      autoCompactionEnabled: true,
      compactAtPercent: 82,
      debugVisibility: 'verbose',
    });
    // camelCase + preserved opaque config round-trips.
    expect(request.contextPolicy).toHaveProperty(
      'targetPercentAfterCompaction',
    );
    expect(request.contextPolicy).toHaveProperty('maxContextPercentForWake');
    expect(request.contextPolicy).toHaveProperty('strategyConfig');
  });

  it('clamps percent controls to the catalog range (#3849)', async () => {
    const { fixture, component } = await runtimeWindow();
    const transport = TestBed.inject(ChatTransport) as unknown as {
      planAdminProfileRegistryRuntimeConfig: RuntimeConfigSpy;
    };
    component.updateContextPercent('compactAtPercent', {
      target: { value: '999' },
    });
    fixture.detectChanges();
    component.planRuntimeConfig(recordFor('rt-prime'));
    await fixture.whenStable();

    const request = lastRuntimeConfigRequest(
      transport.planAdminProfileRegistryRuntimeConfig,
    );
    expect(request.contextPolicy?.compactAtPercent).toBe(100);
  });

  it('surfaces invalid-strategy diagnostics in the plan panel (#3849)', async () => {
    const { fixture, component } = await runtimeWindow();
    // An unknown strategy id comes back as a contextPolicy.strategyId diagnostic.
    component.updateContextStrategy({ target: { value: 'missing_strategy' } });
    fixture.detectChanges();
    component.planRuntimeConfig(recordFor('rt-prime'));
    await fixture.whenStable();
    fixture.detectChanges();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('context_strategy_unknown');
  });
});
