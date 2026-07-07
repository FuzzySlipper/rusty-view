import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AdminStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type RuntimeConfigValidationReport,
} from '@rusty-view/transport';

import { AdminServicePanelComponent } from './admin-service-panel';
import { makeTransport } from './admin-profiles.testing';

const SERVICE_CONTROL_CAPABILITY_IDS = [
  'admin.control.config.reload',
  'admin.control.config.wake_timeout.patch',
  'admin.control.config.draft.plan',
  'admin.control.config.draft.apply',
  'admin.control.profiles.rebuild_brain.plan',
  'admin.control.profiles.rebuild_brain.apply',
  'admin.control.sessions.rebuild_runtime.plan',
  'admin.control.sessions.rebuild_runtime.apply',
] as const;

async function createPanel(capabilityIds?: readonly string[]) {
  await TestBed.configureTestingModule({
    imports: [AdminServicePanelComponent],
    providers: [
      AdminStore,
      {
        provide: ChatTransport,
        useValue:
          capabilityIds === undefined
            ? makeTransport()
            : makeTransport({ capabilityIds }),
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminServicePanelComponent);
  fixture.detectChanges();
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

function textOf(fixture: { nativeElement: HTMLElement }): string {
  return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function applySemantics(fixture: {
  nativeElement: HTMLElement;
}): Map<string, string> {
  const section = Array.from(
    fixture.nativeElement.querySelectorAll('.rv-admin-service__section'),
  ).find(
    (candidate) =>
      candidate.querySelector('h2')?.textContent === 'Apply Semantics',
  );
  if (!(section instanceof HTMLElement)) {
    throw new Error('Apply Semantics section not found');
  }
  const labels = Array.from(section.querySelectorAll('span')).map(
    (entry) => entry.textContent?.trim() ?? '',
  );
  const values = Array.from(section.querySelectorAll('strong')).map(
    (entry) => entry.textContent?.trim() ?? '',
  );
  return new Map(labels.map((label, index) => [label, values[index] ?? '']));
}

function reloadButton(fixture: {
  nativeElement: HTMLElement;
}): HTMLButtonElement {
  const button = Array.from(
    fixture.nativeElement.querySelectorAll('button'),
  ).find((candidate) => candidate.textContent?.trim() === 'Reload');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Reload button not found');
  }
  return button;
}

function serviceButton(
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

function configValidation(
  wakeTimeout?: RuntimeConfigValidationReport['wakeTimeout'],
  runtimeConfig?: RuntimeConfigValidationReport['runtimeConfig'],
): RuntimeConfigValidationReport {
  return {
    ok: true,
    configPath: '/tmp/rusty-crew/config/service.json',
    ...(wakeTimeout === undefined ? {} : { wakeTimeout }),
    ...(runtimeConfig === undefined ? {} : { runtimeConfig }),
    diagnostics: [],
    summary: {
      diagnostics: 0,
      errors: 0,
      warnings: 0,
      brains: 0,
      sessions: 0,
      scheduledJobs: 0,
      channelBindings: 0,
      mcpBindings: 0,
      derivedScheduledJobs: 0,
      derivedMcpBindings: 0,
      sessionDefaultsApplied: 0,
    },
    derived: {
      scheduledJobs: [],
      mcpBindings: [],
      sessionDefaultsApplied: [],
    },
  };
}

describe('AdminServicePanelComponent', () => {
  it('renders available apply semantics from Crew capabilities', async () => {
    const fixture = await createPanel(SERVICE_CONTROL_CAPABILITY_IDS);
    const semantics = applySemantics(fixture);
    const text = textOf(fixture);

    expect(semantics.get('service reload')).toBe('available');
    expect(semantics.get('config save')).toBe('available');
    expect(semantics.get('wake timeout save')).toBe('available');
    expect(semantics.get('brain hot swap')).toBe('available');
    expect(semantics.get('session runtime rebuild')).toBe('available');
    expect(text).not.toContain('backend API needed');
    expect(reloadButton(fixture).disabled).toBe(false);
  });

  it('renders partial apply semantics when only one side of a plan/apply pair exists', async () => {
    const fixture = await createPanel([
      'admin.control.config.draft.plan',
      'admin.control.profiles.rebuild_brain.plan',
    ]);
    const semantics = applySemantics(fixture);

    expect(semantics.get('service reload')).toBe('missing');
    expect(semantics.get('config save')).toBe('partial');
    expect(semantics.get('wake timeout save')).toBe('missing');
    expect(semantics.get('brain hot swap')).toBe('partial');
    expect(semantics.get('session runtime rebuild')).toBe('missing');
    expect(reloadButton(fixture).disabled).toBe(true);
  });

  it('renders checking apply semantics while capabilities are still loading', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminServicePanelComponent],
      providers: [
        AdminStore,
        {
          provide: ChatTransport,
          useValue: makeTransport({
            capabilityIds: SERVICE_CONTROL_CAPABILITY_IDS,
          }),
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminServicePanelComponent);
    fixture.detectChanges();

    const semantics = applySemantics(fixture);
    expect(semantics.get('service reload')).toBe('checking');
    expect(semantics.get('config save')).toBe('checking');
    expect(semantics.get('wake timeout save')).toBe('checking');
    expect(semantics.get('brain hot swap')).toBe('checking');
    expect(reloadButton(fixture).disabled).toBe(true);
  });

  it('renders missing apply semantics when Crew reports no control capabilities', async () => {
    const fixture = await createPanel([]);
    const semantics = applySemantics(fixture);
    const text = textOf(fixture);

    expect(semantics.get('service reload')).toBe('missing');
    expect(semantics.get('config save')).toBe('missing');
    expect(semantics.get('wake timeout save')).toBe('missing');
    expect(semantics.get('brain hot swap')).toBe('missing');
    expect(semantics.get('session runtime rebuild')).toBe('missing');
    expect(text).not.toContain('backend API needed');
    expect(reloadButton(fixture).disabled).toBe(true);
  });

  it('renders disabled wake timeout policy without showing zero or unknown', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminServicePanelComponent],
      providers: [
        AdminStore,
        {
          provide: ChatTransport,
          useValue: makeTransport({
            configValidation: configValidation({ mode: 'disabled' }),
          }),
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminServicePanelComponent);
    fixture.detectChanges();
    await TestBed.inject(AdminStore).refresh();
    fixture.detectChanges();

    const text = textOf(fixture);
    expect(text).toContain('Wake Timeout Policy');
    expect(text).toContain('disabled / no service turn cap');
    expect(text).toContain('editable via wake-timeout patch');
    expect(text).not.toContain('0 ms');
    expect(text).not.toContain('unknown');
    expect(serviceButton(fixture, 'Save').disabled).toBe(false);
  });

  it('renders default wake timeout policy with the configured ms', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminServicePanelComponent],
      providers: [
        AdminStore,
        {
          provide: ChatTransport,
          useValue: makeTransport({
            configValidation: configValidation({
              mode: 'default',
              defaultMs: 600_000,
            }),
          }),
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminServicePanelComponent);
    fixture.detectChanges();
    await TestBed.inject(AdminStore).refresh();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('default 10 min (600,000 ms)');
  });

  it('applies a wake timeout policy using the safe patch route without full draft readback', async () => {
    const transport = makeTransport({
      configValidation: configValidation({ mode: 'disabled' }),
    });
    await TestBed.configureTestingModule({
      imports: [AdminServicePanelComponent],
      providers: [
        AdminStore,
        {
          provide: ChatTransport,
          useValue: transport,
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminServicePanelComponent);
    fixture.detectChanges();
    await TestBed.inject(AdminStore).refresh();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('editable via wake-timeout patch');
    host
      .querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]
      ?.dispatchEvent(new Event('change'));
    const defaultMs = host.querySelector<HTMLInputElement>(
      '.rv-admin-service__wake-ms input',
    );
    if (defaultMs === null) throw new Error('default ms input not found');
    defaultMs.value = '45000';
    defaultMs.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    serviceButton(fixture, 'Save').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const patchCalls = (
      transport.patchWakeTimeoutConfig as unknown as {
        mock: { calls: [unknown][] };
      }
    ).mock.calls;
    const draftCalls = (
      transport.applyRuntimeConfigDraft as unknown as {
        mock: { calls: [unknown][] };
      }
    ).mock.calls;
    expect(patchCalls).toHaveLength(1);
    expect(draftCalls).toHaveLength(0);
    expect(patchCalls[0]?.[0]).toEqual({
      wakeTimeout: { mode: 'default', defaultMs: 45_000 },
      reason: 'rusty-view wake timeout policy update',
    });
    expect(textOf(fixture)).toContain('Last Config Save');
    expect(textOf(fixture)).toContain('wake timeout set to 45000ms');
    expect(textOf(fixture)).toContain('/v1/admin/control/config/wake-timeout');
  });

  it('falls back to the config draft route when a full draft is available but the patch route is absent', async () => {
    const transport = makeTransport({
      capabilityIds: [
        'admin.control.config.draft.plan',
        'admin.control.config.draft.apply',
      ],
      configValidation: configValidation(
        { mode: 'disabled' },
        {
          profilesDir: '/tmp/profiles',
          wakeTimeout: { mode: 'disabled' },
          brains: [{ implementationId: 'brain-1', profileId: 'p1' }],
          sessions: [{ sessionId: 's1', agentId: 'a1', profileId: 'p1' }],
          scheduledJobs: [],
          channelBindings: [],
          mcpBindings: [],
        },
      ),
    });
    await TestBed.configureTestingModule({
      imports: [AdminServicePanelComponent],
      providers: [
        AdminStore,
        {
          provide: ChatTransport,
          useValue: transport,
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminServicePanelComponent);
    fixture.detectChanges();
    await TestBed.inject(AdminStore).refresh();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('editable via config draft');
    host
      .querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]
      ?.dispatchEvent(new Event('change'));
    const defaultMs = host.querySelector<HTMLInputElement>(
      '.rv-admin-service__wake-ms input',
    );
    if (defaultMs === null) throw new Error('default ms input not found');
    defaultMs.value = '45000';
    defaultMs.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    serviceButton(fixture, 'Save').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const calls = (
      transport.applyRuntimeConfigDraft as unknown as {
        mock: { calls: [unknown][] };
      }
    ).mock.calls;
    const patchCalls = (
      transport.patchWakeTimeoutConfig as unknown as {
        mock: { calls: [unknown][] };
      }
    ).mock.calls;
    expect(calls).toHaveLength(1);
    expect(patchCalls).toHaveLength(0);
    expect(calls[0]?.[0]).toMatchObject({
      runtimeConfig: {
        profilesDir: '/tmp/profiles',
        wakeTimeout: { mode: 'default', defaultMs: 45_000 },
        brains: [{ implementationId: 'brain-1', profileId: 'p1' }],
        sessions: [{ sessionId: 's1', agentId: 'a1', profileId: 'p1' }],
      },
      reason: 'rusty-view wake timeout policy update',
    });
    expect(textOf(fixture)).toContain('Last Config Save');
    expect(textOf(fixture)).toContain('runtime config draft applied');
  });

  it('reloads service config through the store and surfaces the Crew result', async () => {
    const fixture = await createPanel(SERVICE_CONTROL_CAPABILITY_IDS);
    const button = reloadButton(fixture);

    button.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = textOf(fixture);
    expect(text).toContain('Last Reload');
    expect(text).toContain('completedruntime config reloaded');
    expect(text).toContain('brains present1');
  });
});
