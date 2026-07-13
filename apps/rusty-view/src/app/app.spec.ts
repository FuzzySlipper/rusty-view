import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ChatTransport } from '@rusty-view/transport';
import {
  AdminStore,
  ChatStore,
  CHAT_STORAGE_ADAPTER,
  IndexedDbChatStorage,
} from '@rusty-view/chat-store';
import type { ChatSessionPage } from '@rusty-view/protocol';
import {
  CHAT_SETTINGS_STORAGE,
  ChatTheme,
  InMemoryChatSettingsStorage,
} from '@rusty-view/chat-theme';

import { App } from './app';

/** A mock transport that returns empty results without network calls. */
const mockTransport: ChatTransport = {
  getConfig: () => ({ baseUrl: 'http://mock', timeoutMs: 5000 }),
  listSessions: async (): Promise<ChatSessionPage> => ({
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
  }),
  openSession: async () => ({
    session: {
      session_id: 'test',
      agent_id: 'a',
      profile_id: 'p',
      kind: 'full',
      status: 'active',
      latest_cursor: '',
      updated_at: '',
    },
    events: [],
    latest_cursor: '',
    has_more_before: false,
  }),
  replayEvents: async () => [],
  sendMessage: async () => ({
    status: 'accepted',
    message_id: 'm',
    latest_cursor: '',
  }),
  listCommands: async () => ({ commands: [] }),
  sendCommand: async () => ({
    status: 'completed',
    command_name: 'test',
    summary: '',
    latest_cursor: '',
  }),
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
  adminSessions: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
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
    capabilities: [],
  }),
  streamEvents: () =>
    ({
      events: async function* () {
        // Empty stream for tests — no events to yield.
      },
      onStateChange: () => () => undefined,
      getState: () => ({ status: 'idle' }),
      getLastCursor: () => undefined,
      close: () => undefined,
    }) as never,
} as unknown as ChatTransport;

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: ChatTransport, useValue: mockTransport },
        { provide: CHAT_STORAGE_ADAPTER, useValue: new IndexedDbChatStorage() },
        {
          provide: CHAT_SETTINGS_STORAGE,
          useValue: new InMemoryChatSettingsStorage(),
        },
        ChatTheme,
        ChatStore,
        AdminStore,
      ],
    }).compileComponents();
  });

  it('renders the debug shell', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('rv-debug-shell')).not.toBeNull();
  });
});
