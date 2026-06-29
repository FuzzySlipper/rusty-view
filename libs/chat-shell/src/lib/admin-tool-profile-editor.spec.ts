import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AdminStore } from '@rusty-view/chat-store';
import {
  ChatTransport,
  type AdminLocalToolProfile,
  type AdminLocalToolProfileWriteRequest,
} from '@rusty-view/transport';

import { AdminToolProfileEditorComponent } from './admin-tool-profile-editor';
import {
  localToolProfiles,
  makeTransport,
  toolCatalog,
  type TransportOptions,
} from './admin-profiles.testing';

async function editor(options: TransportOptions = {}) {
  await TestBed.configureTestingModule({
    imports: [AdminToolProfileEditorComponent],
    providers: [
      AdminStore,
      { provide: ChatTransport, useValue: makeTransport(options) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminToolProfileEditorComponent);
  fixture.detectChanges();
  await TestBed.inject(AdminStore).refresh();
  fixture.detectChanges();
  return fixture;
}

interface EditorApi {
  startNew(): void;
  startEdit(profile: AdminLocalToolProfile): void;
  updateText(
    field: 'id' | 'displayName' | 'description',
    event: { target: { value: string } },
  ): void;
  toggleToolset(id: string, event: { target: { checked: boolean } }): void;
  save(): void;
  deleteProfile(profile: AdminLocalToolProfile): void;
}

function profileFromStore(id: string): AdminLocalToolProfile {
  const profile = TestBed.inject(AdminStore)
    .localToolProfiles()
    .find((entry) => entry.id === id);
  if (profile === undefined) throw new Error(`${id} not found`);
  return profile;
}

describe('AdminToolProfileEditorComponent', () => {
  it('lists local tool profiles with catalog labels and diagnostics', async () => {
    const fixture = await editor({
      localToolProfiles: localToolProfiles(),
      toolCatalog: toolCatalog(),
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Planner tools');
    expect(text).toContain('planner-tools');
    // Stale-reference diagnostic surfaced read-only.
    expect(text).toContain('tool_profile_stale_reference');
  });

  it('shows a non-blocking empty state when no tool profiles exist', async () => {
    const fixture = await editor();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No local tool profiles configured');
  });

  it('creates a new local tool profile from the form', async () => {
    const fixture = await editor({ toolCatalog: toolCatalog() });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminCreateLocalToolProfile: {
        mock: { calls: [AdminLocalToolProfileWriteRequest][] };
      };
    };
    const component = fixture.componentInstance as unknown as EditorApi;

    component.updateText('id', { target: { value: 'new-profile' } });
    component.updateText('displayName', { target: { value: 'New Profile' } });
    component.toggleToolset('local_code_read', { target: { checked: true } });
    fixture.detectChanges();
    component.save();
    await fixture.whenStable();

    const calls = transport.adminCreateLocalToolProfile.mock.calls;
    expect(calls).toHaveLength(1);
    const createCall = calls[0];
    if (createCall === undefined) throw new Error('create not called');
    expect(createCall[0]).toMatchObject({
      id: 'new-profile',
      displayName: 'New Profile',
      enabled: true,
      requestedToolsets: ['local_code_read'],
    });
  });

  it('updates an existing profile with its expected revision', async () => {
    const fixture = await editor({
      localToolProfiles: localToolProfiles(),
      toolCatalog: toolCatalog(),
    });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminUpdateLocalToolProfile: {
        mock: { calls: [string, AdminLocalToolProfileWriteRequest][] };
      };
    };
    const component = fixture.componentInstance as unknown as EditorApi;

    component.startEdit(profileFromStore('planner-tools'));
    component.updateText('displayName', { target: { value: 'Renamed' } });
    fixture.detectChanges();
    component.save();
    await fixture.whenStable();

    const calls = transport.adminUpdateLocalToolProfile.mock.calls;
    expect(calls).toHaveLength(1);
    const updateCall = calls[0];
    if (updateCall === undefined) throw new Error('update not called');
    const [id, body] = updateCall;
    expect(id).toBe('planner-tools');
    expect(body).toMatchObject({ displayName: 'Renamed', expectedRevision: 2 });
  });

  it('deletes an editable profile', async () => {
    const fixture = await editor({ localToolProfiles: localToolProfiles() });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminDeleteLocalToolProfile: { mock: { calls: [string][] } };
    };
    const component = fixture.componentInstance as unknown as EditorApi;

    component.deleteProfile(profileFromStore('planner-tools'));
    await fixture.whenStable();

    expect(transport.adminDeleteLocalToolProfile.mock.calls).toEqual([
      ['planner-tools'],
    ]);
  });

  it('does not offer edit/delete for a read-only/system profile', async () => {
    const fixture = await editor({ localToolProfiles: localToolProfiles() });
    const host = fixture.nativeElement as HTMLElement;
    const readOnlyRow = Array.from(
      host.querySelectorAll('.rv-admin-profiles__profile'),
    ).find((li) => (li.textContent ?? '').includes('builtin-readonly'));
    const buttons = Array.from(
      readOnlyRow?.querySelectorAll('button') ?? [],
    ).map((b) => b.textContent?.trim());
    expect(buttons).not.toContain('Edit');
    expect(buttons).not.toContain('Delete');
    expect(readOnlyRow?.textContent ?? '').toContain('read-only');
  });

  it('surfaces a write error from the store', async () => {
    const fixture = await editor({ toolCatalog: toolCatalog() });
    const transport = TestBed.inject(ChatTransport) as unknown as {
      adminCreateLocalToolProfile: (
        body: AdminLocalToolProfileWriteRequest,
      ) => Promise<unknown>;
    };
    transport.adminCreateLocalToolProfile = async () => {
      throw new Error('id already exists');
    };
    const component = fixture.componentInstance as unknown as EditorApi;

    component.updateText('id', { target: { value: 'dup' } });
    fixture.detectChanges();
    component.save();
    await fixture.whenStable();
    fixture.detectChanges();

    const error =
      (fixture.nativeElement as HTMLElement).querySelector(
        '.rv-admin-profiles__error',
      )?.textContent ?? '';
    expect(error).toContain('id already exists');
  });
});
