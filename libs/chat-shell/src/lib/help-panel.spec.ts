import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { ChatStore } from '@rusty-view/chat-store';
import type { ChatCommandDescriptor } from '@rusty-view/protocol';

import { HelpPanelComponent } from './help-panel';

function makeCommand(
  overrides: Partial<ChatCommandDescriptor>,
): ChatCommandDescriptor {
  return {
    name: 'status',
    description: 'Show session status.',
    read_only: true,
    mutating: false,
    scope: 'session',
    requires_control_auth: false,
    ...overrides,
  } as ChatCommandDescriptor;
}

describe('HelpPanelComponent', () => {
  async function createHelp(commands: ChatCommandDescriptor[]) {
    const store = {
      commands: () => commands,
    } as unknown as ChatStore;

    await TestBed.configureTestingModule({
      imports: [HelpPanelComponent],
      providers: [{ provide: ChatStore, useValue: store }],
    }).compileComponents();

    const fixture = TestBed.createComponent(HelpPanelComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('lists commands from the registry', async () => {
    const fixture = await createHelp([
      makeCommand({ name: 'status', description: 'Show status.' }),
      makeCommand({ name: 'new', description: 'Start a new session.', mutating: true }),
    ]);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('/status');
    expect(host.textContent).toContain('Show status.');
    expect(host.textContent).toContain('/new');
    expect(host.querySelector('.rv-help__flag--mut')).not.toBeNull();
  });

  it('shows an empty state when the registry is empty', async () => {
    const fixture = await createHelp([]);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('No commands loaded');
  });

  it('joins aliases and arg keys', async () => {
    const fixture = await createHelp([
      makeCommand({
        name: 'reload',
        aliases: ['r', 'rl'],
        args_schema: { target: { type: 'string' }, force: { type: 'boolean' } },
      }),
    ]);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('r, rl');
    expect(host.textContent).toContain('target, force');
  });
});
