import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AdminStore } from '@rusty-view/chat-store';
import { ChatTransport } from '@rusty-view/transport';

import { AdminServicePanelComponent } from './admin-service-panel';
import { makeTransport } from './admin-profiles.testing';

const SERVICE_CONTROL_CAPABILITY_IDS = [
  'admin.control.config.reload',
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

describe('AdminServicePanelComponent', () => {
  it('renders available apply semantics from Crew capabilities', async () => {
    const fixture = await createPanel(SERVICE_CONTROL_CAPABILITY_IDS);
    const semantics = applySemantics(fixture);
    const text = textOf(fixture);

    expect(semantics.get('service reload')).toBe('available');
    expect(semantics.get('config save')).toBe('available');
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
    expect(semantics.get('brain hot swap')).toBe('checking');
    expect(reloadButton(fixture).disabled).toBe(true);
  });

  it('renders missing apply semantics when Crew reports no control capabilities', async () => {
    const fixture = await createPanel([]);
    const semantics = applySemantics(fixture);
    const text = textOf(fixture);

    expect(semantics.get('service reload')).toBe('missing');
    expect(semantics.get('config save')).toBe('missing');
    expect(semantics.get('brain hot swap')).toBe('missing');
    expect(semantics.get('session runtime rebuild')).toBe('missing');
    expect(text).not.toContain('backend API needed');
    expect(reloadButton(fixture).disabled).toBe(true);
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
