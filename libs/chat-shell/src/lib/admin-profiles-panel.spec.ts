import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import { ChatTransport } from '@rusty-view/transport';

import { AdminProfilesPanelComponent } from './admin-profiles-panel';
import {
  LANDED_PROFILE_CONTROL_CAPABILITY_IDS,
  makeTransport,
  mcpCatalog,
  registryDiagnostics,
  toolCatalog,
  type TransportOptions,
} from './admin-profiles.testing';

async function createPanel(options: TransportOptions = {}) {
  await TestBed.configureTestingModule({
    imports: [AdminProfilesPanelComponent],
    providers: [
      AdminStore,
      { provide: ChatStore, useValue: { refreshSessions: vi.fn() } },
      { provide: ChatTransport, useValue: makeTransport(options) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminProfilesPanelComponent);
  fixture.detectChanges();
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

describe('AdminProfilesPanelComponent (list coordinator)', () => {
  it('does not advertise manual model/provider rebuild controls', async () => {
    const fixture = await createPanel({
      capabilityIds: LANDED_PROFILE_CONTROL_CAPABILITY_IDS,
    });
    const capabilityText =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__capabilities',
      )?.textContent ?? '';

    expect(capabilityText).toContain('Profile file edits');
    expect(capabilityText).not.toContain('Model/provider changes');
    expect(capabilityText).not.toContain('rebuild');
    expect(capabilityText).not.toContain('backend API needed');
  });

  it('lists registry records as summary rows with an Edit button', async () => {
    const fixture = await createPanel({
      profileDiagnostics: registryDiagnostics({
        profileId: 'field-prime',
        displayName: 'Field Prime',
        revision: 3,
      }),
    });
    const host = fixture.nativeElement as HTMLElement;
    const registryText =
      host.querySelector('.rv-admin-profiles__registry')?.textContent ?? '';

    expect(registryText).toContain('field-prime');
    expect(registryText).toContain('DB registry');
    // Summary only: no inline edit form fields in the list.
    expect(
      host.querySelector('.rv-admin-profiles__prompt-edit-grid'),
    ).toBeNull();
    const buttons = Array.from(host.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(buttons).toContain('Edit');
  });

  it('separates desired MCP intent from concurrent exact-session materializations', async () => {
    const fixture = await createPanel({
      profileDiagnostics: registryDiagnostics({
        profileId: 'ambassador',
        revision: 9,
        desiredMcpBindings: [{ serverId: 'den', bindingId: 'ambassador-den' }],
        materializedMcpBindings: [
          {
            serverId: 'den',
            bindingId: 'ambassador-den--session--ordinary-1',
            sessionId: 'ordinary-1',
            agentId: 'ambassador-agent',
            status: 'active',
            toolProfileKey: 'ambassador',
            sessionKind: 'ordinary',
            appliedProfileRevision: 9,
          },
          {
            serverId: 'den',
            bindingId: 'ambassador-den--session--external-1',
            sessionId: 'external-1',
            agentId: 'ambassador-agent-external',
            status: 'active',
            toolProfileKey: 'ambassador',
            sessionKind: 'managed_external',
            appliedProfileRevision: 8,
            externalBindingId: 'external-binding-1',
          },
        ],
        mcpReconciliation: {
          state: 'converged',
          desiredCount: 1,
          materializedCount: 2,
          sessionCount: 2,
          action: 'none',
        },
      }),
      mcpSurfaces: [
        {
          bindingId: 'ambassador-den--session--ordinary-1',
          status: 'active',
        },
        {
          bindingId: 'ambassador-den--session--external-1',
          status: 'degraded',
        },
      ],
    });
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__mcp',
      )?.textContent ?? '';

    expect(text).toContain('Desired MCP servers');
    expect(text).toContain('ordinary-1');
    expect(text).toContain('external-1');
    expect(text).toContain('managed_external');
    expect(text).toContain('tools callable');
    expect(text).toContain('tools unavailable');
    expect(text).toContain('profile revision current');
    expect(text).toContain('stale (applied 8, current 9)');
  });

  it('blocks edit for a file-backed fallback profile and shows guidance', async () => {
    const fixture = await createPanel({
      profileDiagnostics: {
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
            externalMessageDeliveryPolicy: 'immediate_steer',
          },
        ],
        registryCount: 0,
        fileFallbackCount: 1,
        driftCount: 0,
        missingAssetCount: 0,
        diagnostics: [],
      },
    });
    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    // No per-row Edit button for a file-backed record.
    expect(buttons.filter((b) => b === 'Edit')).toHaveLength(0);
    expect((host.textContent ?? '').toLowerCase()).toContain('import');
  });

  it('opens the Create window when Create Profile is clicked', async () => {
    const fixture = await createPanel({ toolCatalog: toolCatalog() });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('rv-admin-profile-create')).toBeNull();

    const createButton = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Create Profile',
    );
    createButton?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-admin-profile-create')).not.toBeNull();
  });

  it('opens the Tool Profiles editor window', async () => {
    const fixture = await createPanel({ toolCatalog: toolCatalog() });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('rv-admin-tool-profile-editor')).toBeNull();

    const button = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Tool Profiles',
    );
    button?.click();
    fixture.detectChanges();

    expect(host.querySelector('rv-admin-tool-profile-editor')).not.toBeNull();
  });

  it('opens the Edit window for an editable profile', async () => {
    const fixture = await createPanel({
      profileDiagnostics: registryDiagnostics({
        profileId: 'field-prime',
        displayName: 'Field Prime',
        revision: 3,
      }),
      mcpCatalog: mcpCatalog(),
    });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('rv-admin-profile-edit')).toBeNull();

    const editButton = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit',
    );
    editButton?.click();
    fixture.detectChanges();

    const editWindow = host.querySelector('rv-admin-profile-edit');
    expect(editWindow).not.toBeNull();
    expect(editWindow?.textContent ?? '').toContain('field-prime');
  });
});
