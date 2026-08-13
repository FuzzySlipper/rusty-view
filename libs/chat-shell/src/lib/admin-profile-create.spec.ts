import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type CreateAdminProfileRequest,
} from '@rusty-view/transport';

import { AdminProfileCreateComponent } from './admin-profile-create';
import {
  lastCreateRequest,
  localToolProfiles,
  makeTransport,
  mcpCatalog,
  toolCatalog,
  type TransportOptions,
} from './admin-profiles.testing';

async function createWindow(
  options: TransportOptions = {},
  initialWorkspace = '/home/dev',
) {
  await TestBed.configureTestingModule({
    imports: [AdminProfileCreateComponent],
    providers: [
      AdminStore,
      { provide: ChatStore, useValue: { refreshSessions: vi.fn() } },
      { provide: ChatTransport, useValue: makeTransport(options) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminProfileCreateComponent);
  fixture.detectChanges();
  if (initialWorkspace !== '') {
    (fixture.componentInstance as unknown as CreateComponentApi).updateText(
      'workspaceCwd',
      {
        target: { value: initialWorkspace },
      },
    );
  }
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

interface CreateComponentApi {
  updateText(
    field:
      | 'profileId'
      | 'sessionId'
      | 'implementationId'
      | 'workspaceCwd'
      | 'modelConfigId'
      | 'soulMarkdown',
    event: { target: { value: string } },
  ): void;
  updateKind(event: { target: { value: string } }): void;
  toggleMcpServer(
    serverId: string,
    event: { target: { checked: boolean } },
  ): void;
  updateMcpToolProfileKey(
    serverId: string,
    event: { target: { value: string } },
  ): void;
  toggleToolset(
    toolsetId: string,
    event: { target: { checked: boolean } },
  ): void;
  toggleTool(toolName: string, event: { target: { checked: boolean } }): void;
  updateSelectedToolProfile(event: { target: { value: string } }): void;
  toggleCustomTools(): void;
  createProfile(): void;
}

function transportSpy(): {
  createAdminProfile: { mock: { calls: [CreateAdminProfileRequest][] } };
} {
  return TestBed.inject(ChatTransport) as unknown as {
    createAdminProfile: { mock: { calls: [CreateAdminProfileRequest][] } };
  };
}

describe('AdminProfileCreateComponent', () => {
  it('creates a minimal profile using backend-owned defaults', async () => {
    const fixture = await createWindow();
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'minimal-prime' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.profileId).toBe('minimal-prime');
    expect(request.workspaceCwd).toBe('/home/dev');
    expect(request).not.toHaveProperty('modelConfig');
    expect(request).not.toHaveProperty('kind');
  });

  it('creates a profile with a normalized model configuration selection', async () => {
    const fixture = await createWindow();
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'gpt-default · Default endpoint (config-default)',
    );
    component.updateText('profileId', { target: { value: 'model-prime' } });
    component.updateText('modelConfigId', {
      target: { value: 'config-default' },
    });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.modelConfigId).toBe('config-default');
    expect(request).not.toHaveProperty('providerAlias');
  });

  it('requires an explicit initial workspace for the default full session', async () => {
    const fixture = await createWindow({}, '');
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'needs-workspace' } });
    fixture.detectChanges();

    const createButton = (fixture.nativeElement as HTMLElement).querySelector(
      'button.rv-admin-profiles__button--primary',
    ) as HTMLButtonElement | null;
    expect(createButton?.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'is not stored as a profile cwd',
    );
  });

  it('keeps the form open and surfaces an embedded failed control outcome', async () => {
    const fixture = await createWindow();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;
    const transport = TestBed.inject(ChatTransport);
    const created = vi.fn();
    fixture.componentInstance.created.subscribe(created);
    vi.spyOn(transport, 'createAdminProfile').mockResolvedValue({
      command: {
        name: 'create_profile',
        target: {},
        requestId: 'req-failed',
      },
      outcome: {
        status: 'failed',
        summary: 'initial session workspace is invalid',
        reasonCode: 'control_executor_failed',
      },
      audit: { started: true, terminal: true },
      observation: {},
    });

    component.updateText('profileId', { target: { value: 'failed-prime' } });
    component.createProfile();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(created).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'initial session workspace is invalid',
    );
  });

  it('omits sessionId/implementationId/mcpToolProfile/mcpBindings/toolPolicy by default', async () => {
    const fixture = await createWindow();
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'default-prime' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request).not.toHaveProperty('sessionId');
    expect(request).not.toHaveProperty('implementationId');
    expect(request).not.toHaveProperty('mcpToolProfile');
    expect(request).not.toHaveProperty('mcpBindings');
    expect(request).not.toHaveProperty('toolPolicy');
  });

  it('sends kind only when explicitly selected', async () => {
    const fixture = await createWindow();
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'kind-prime' } });
    component.updateKind({ target: { value: 'worker' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    expect(lastCreateRequest(transport.createAdminProfile).kind).toBe('worker');
  });

  it('seeds soul.md when provided during create', async () => {
    const fixture = await createWindow();
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'soul-prime' } });
    component.updateText('soulMarkdown', {
      target: { value: 'You are Soul Prime.\nKeep the line breaks.' },
    });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.soulMarkdown).toBe(
      'You are Soul Prime.\nKeep the line breaks.',
    );
  });

  it('preserves advanced session/implementation overrides when set', async () => {
    const fixture = await createWindow();
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'override-prime' } });
    component.updateText('sessionId', { target: { value: 'custom-session' } });
    component.updateText('implementationId', {
      target: { value: 'custom-brain' },
    });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.sessionId).toBe('custom-session');
    expect(request.implementationId).toBe('custom-brain');
  });

  it('renders configured MCP servers as selectable choices', async () => {
    const fixture = await createWindow({ mcpCatalog: mcpCatalog() });
    const select =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__mcp-select',
      )?.textContent ?? '';

    expect(select).toContain('den');
    expect(select).toContain('streamable_http');
    expect(select).toContain('runtime');
    expect(select).toContain('files');
    expect(select).not.toContain('base URL');
  });

  it('shows a non-blocking empty state when no MCP servers are configured', async () => {
    const fixture = await createWindow();
    const select =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__mcp-select',
      )?.textContent ?? '';
    expect(select).toContain('No MCP servers configured');
  });

  it('sends mcpBindings for each selected server with optional tool profile key', async () => {
    const fixture = await createWindow({ mcpCatalog: mcpCatalog() });
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'mcp-prime' } });
    component.toggleMcpServer('den', { target: { checked: true } });
    component.updateMcpToolProfileKey('den', { target: { value: 'planner' } });
    component.toggleMcpServer('files', { target: { checked: true } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    expect(lastCreateRequest(transport.createAdminProfile).mcpBindings).toEqual(
      [{ serverId: 'den', toolProfileKey: 'planner' }, { serverId: 'files' }],
    );
  });

  it('drops a deselected MCP server from the bindings', async () => {
    const fixture = await createWindow({ mcpCatalog: mcpCatalog() });
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'toggle-prime' } });
    component.toggleMcpServer('den', { target: { checked: true } });
    component.toggleMcpServer('den', { target: { checked: false } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    expect(lastCreateRequest(transport.createAdminProfile)).not.toHaveProperty(
      'mcpBindings',
    );
  });

  it('renders built-in toolsets and tools under the custom disclosure', async () => {
    const fixture = await createWindow({ toolCatalog: toolCatalog() });
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;
    component.toggleCustomTools();
    fixture.detectChanges();

    const policy =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__tool-policy',
      )?.textContent ?? '';

    expect(policy).toContain('local_code_read');
    expect(policy).toContain('Local code read');
    expect(policy).toContain('3 tools');
    expect(policy).toContain('memory_profile');
    expect(policy).toContain('Individual tools');
    expect(policy).toContain('todo');
  });

  it('shows a non-blocking empty state when no tool catalog is reported', async () => {
    const fixture = await createWindow();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;
    component.toggleCustomTools();
    fixture.detectChanges();
    const policy =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__tool-policy',
      )?.textContent ?? '';
    expect(policy).toContain('No built-in tool catalog reported');
  });

  it('sends toolPolicy with selected toolsets/tools and shows the review', async () => {
    const fixture = await createWindow({ toolCatalog: toolCatalog() });
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'tools-prime' } });
    component.toggleCustomTools();
    component.toggleToolset('local_code_read', { target: { checked: true } });
    component.toggleTool('todo', { target: { checked: true } });
    fixture.detectChanges();

    const review =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__tool-policy-review',
      )?.textContent ?? '';
    expect(review).toContain('local_code_read');
    expect(review).toContain('todo');

    component.createProfile();
    await fixture.whenStable();

    expect(lastCreateRequest(transport.createAdminProfile).toolPolicy).toEqual({
      requestedToolsets: ['local_code_read'],
      requestedTools: ['todo'],
    });
  });

  it('omits toolPolicy when a deselected toolset leaves nothing selected', async () => {
    const fixture = await createWindow({ toolCatalog: toolCatalog() });
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'untool-prime' } });
    component.toggleCustomTools();
    component.toggleToolset('local_code_read', { target: { checked: true } });
    component.toggleToolset('local_code_read', { target: { checked: false } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    expect(lastCreateRequest(transport.createAdminProfile)).not.toHaveProperty(
      'toolPolicy',
    );
  });

  it('renders local tool profiles in the dropdown and prefers them (#3689)', async () => {
    const fixture = await createWindow({
      localToolProfiles: localToolProfiles(),
      toolCatalog: toolCatalog(),
    });
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    const policyText =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__tool-policy',
      )?.textContent ?? '';
    expect(policyText).toContain('Local tool profile');
    expect(policyText).toContain('Planner tools');

    component.updateText('profileId', { target: { value: 'ltp-prime' } });
    component.updateSelectedToolProfile({ target: { value: 'planner-tools' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    // Crew expects the reusable profile as a top-level field, not nested in
    // toolPolicy (which is reserved for inline toolset/tool requests).
    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.localToolProfileId).toBe('planner-tools');
    expect(request).not.toHaveProperty('toolPolicy');
  });

  it('falls back to a non-blocking empty state when no local tool profiles exist', async () => {
    const fixture = await createWindow();
    const policyText =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__tool-policy',
      )?.textContent ?? '';
    expect(policyText).toContain('No local tool profiles configured');
  });

  it('prefers a selected local tool profile over inline custom selections', async () => {
    const fixture = await createWindow({
      localToolProfiles: localToolProfiles(),
      toolCatalog: toolCatalog(),
    });
    const transport = transportSpy();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'pref-prime' } });
    component.toggleCustomTools();
    component.toggleToolset('local_code_read', { target: { checked: true } });
    component.updateSelectedToolProfile({ target: { value: 'planner-tools' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    // Local tool profile wins; raw toolsets are not sent, and the reference is
    // sent as a top-level field rather than nested in toolPolicy.
    const request = lastCreateRequest(transport.createAdminProfile);
    expect(request.localToolProfileId).toBe('planner-tools');
    expect(request).not.toHaveProperty('toolPolicy');
  });

  it('surfaces the planned runtime graph from the create flow', async () => {
    const fixture = await createWindow();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;

    component.updateText('profileId', { target: { value: 'planned-prime' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();
    fixture.detectChanges();

    const preview =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__create-preview',
      )?.textContent ?? '';
    expect(preview).toContain('Planned runtime graph');
    expect(preview).toContain('planned-prime-brain');
    expect(preview).toContain('planned-prime-session');
  });

  it('emits created after a successful create', async () => {
    const fixture = await createWindow();
    const component =
      fixture.componentInstance as unknown as CreateComponentApi;
    let emitted = false;
    (
      fixture.componentInstance as unknown as {
        created: { subscribe(fn: () => void): void };
      }
    ).created.subscribe(() => (emitted = true));

    component.updateText('profileId', { target: { value: 'emit-prime' } });
    fixture.detectChanges();
    component.createProfile();
    await fixture.whenStable();

    expect(emitted).toBe(true);
  });
});
