import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AdminStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type AdminProfileRegistryRecord,
} from '@rusty-view/transport';

import { AdminProfileEditComponent } from './admin-profile-edit';
import {
  makeTransport,
  mcpCatalog,
  registryDiagnostics,
  type TransportOptions,
} from './admin-profiles.testing';

async function editWindow(profileId: string, options: TransportOptions = {}) {
  await TestBed.configureTestingModule({
    imports: [AdminProfileEditComponent],
    providers: [
      AdminStore,
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
  showSection(section: 'fields' | 'lifecycle' | 'prompts'): void;
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
}

function recordFor(profileId: string): AdminProfileRegistryRecord {
  const record = TestBed.inject(AdminStore)
    .registryRecords()
    .find((entry) => entry.profileId === profileId);
  if (record === undefined) throw new Error(`${profileId} record not found`);
  return record;
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
    expect(text).toContain('Overview (read-only)');
    expect(text).toContain('Brains');
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
});
