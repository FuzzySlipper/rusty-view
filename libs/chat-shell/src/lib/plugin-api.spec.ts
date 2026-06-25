import { InjectionToken } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  CHAT_OPTIONS_TABS,
  CHAT_TOP_MENU_ITEMS,
} from './shell-extension-tokens';
import {
  CHAT_CONTENT_RENDERERS,
  CHAT_DATA_ACTIONS,
  CHAT_ENUM_PROVIDERS,
  CHAT_MESSAGE_TOOLBAR_ACTIONS,
  CHAT_PLUGINS,
  CHAT_SIDEBAR_PANELS,
  CHAT_SLASH_COMMANDS,
  provideChatPlugins,
  type ChatPlugin,
} from './plugin-api';

class DummyComponent {}

const EXTRA_TOKEN = new InjectionToken<string>('EXTRA_TOKEN');

describe('provideChatPlugins', () => {
  it('registers plugins and flattens generic contribution arrays', () => {
    const pluginA: ChatPlugin = {
      id: 'agent-workbench',
      topMenuItems: [
        { id: 'runs', label: 'Runs', kind: 'panel', panelId: 'runs', order: 40 },
      ],
      settingsPanels: [
        { id: 'agent-settings', label: 'Agent', component: DummyComponent },
      ],
      contentRenderers: [
        { type: 'diagnostic', component: DummyComponent },
      ],
      slashCommands: [
        {
          name: 'inspect',
          description: 'Inspect the current session',
          palettes: ['chat-input', 'global'],
          sideEffect: 'read',
          async run() {
            return { type: 'silent' };
          },
        },
      ],
      enumProviders: [
        {
          id: 'sessions',
          values: () => ['s1', 's2'],
        },
      ],
    };
    const pluginB: ChatPlugin = {
      id: 'downstream-ui',
      sidebarPanels: [
        { id: 'overview', title: 'Overview', component: DummyComponent },
      ],
      messageToolbarActions: [
        { id: 'copy-id', label: 'Copy id', sideEffect: 'none' },
      ],
    };

    TestBed.configureTestingModule({
      providers: [provideChatPlugins(pluginA, pluginB)],
    });

    expect(TestBed.inject(CHAT_PLUGINS).map((p) => p.id)).toEqual([
      'agent-workbench',
      'downstream-ui',
    ]);
    expect(TestBed.inject(CHAT_TOP_MENU_ITEMS).map((i) => i.id)).toEqual([
      'runs',
    ]);
    expect(TestBed.inject(CHAT_OPTIONS_TABS).map((t) => t.id)).toEqual([
      'agent-settings',
    ]);
    expect(TestBed.inject(CHAT_CONTENT_RENDERERS).map((r) => r.type)).toEqual([
      'diagnostic',
    ]);
    expect(TestBed.inject(CHAT_SLASH_COMMANDS).map((c) => c.name)).toEqual([
      'inspect',
    ]);
    expect(TestBed.inject(CHAT_ENUM_PROVIDERS).map((p) => p.id)).toEqual([
      'sessions',
    ]);
    expect(TestBed.inject(CHAT_SIDEBAR_PANELS).map((p) => p.id)).toEqual([
      'overview',
    ]);
    expect(TestBed.inject(CHAT_MESSAGE_TOOLBAR_ACTIONS).map((a) => a.id)).toEqual([
      'copy-id',
    ]);
  });

  it('exposes user data actions with side-effect and confirmation metadata', () => {
    const plugin: ChatPlugin = {
      id: 'mechanic-actions',
      providers: [{ provide: EXTRA_TOKEN, useValue: 'extra' }],
      dataActions: [
        {
          id: 'settings.toggle',
          label: 'Toggle setting',
          description: 'Toggle a user setting after confirmation',
          scope: 'settings',
          sideEffect: 'write',
          confirmation: {
            required: true,
            title: 'Apply setting change?',
            message: 'This changes a user-side preference.',
          },
          async run(context) {
            const ok = await context.confirm({
              required: true,
              title: 'Apply setting change?',
            });
            return ok
              ? { status: 'completed', summary: 'Changed setting' }
              : { status: 'cancelled', summary: 'User cancelled' };
          },
        },
      ],
    };

    TestBed.configureTestingModule({
      providers: [provideChatPlugins(plugin)],
    });

    expect(TestBed.inject(EXTRA_TOKEN)).toBe('extra');
    const action = TestBed.inject(CHAT_DATA_ACTIONS)[0];
    expect(action?.id).toBe('settings.toggle');
    expect(action?.sideEffect).toBe('write');
    expect(action?.confirmation?.required).toBe(true);
  });
});
