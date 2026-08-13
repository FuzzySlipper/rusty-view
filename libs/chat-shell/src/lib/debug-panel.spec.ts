import { TestBed } from '@angular/core/testing';
import { Component, signal, type Provider } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import type {
  AgentMessageTrafficItem,
  ChatEvent,
  ProviderRequestDebugDetail,
} from '@rusty-view/protocol';
import type {
  StorageQueryCatalog,
  StorageQueryResult,
} from '@rusty-view/transport';
import { WorkerManager } from '@rusty-view/transcript-renderer';

import { DebugPanelComponent } from './debug-panel';
import { CHAT_DEBUG_TABS } from './shell-extension-tokens';

@Component({
  selector: 'rv-test-service-controls',
  template: '<div data-testid="service-controls">Service controls</div>',
})
class TestServiceControlsComponent {}

@Component({
  selector: 'rv-test-reserved-debug',
  template: '<div data-testid="reserved-debug-replacement">replacement</div>',
})
class TestReservedDebugComponent {}

function providerStatusEvent(): ChatEvent {
  return {
    event_id: 'evt_provider',
    session_id: 'sess_1',
    sequence_id: 1,
    created_at: '2026-07-05T00:00:00Z',
    kind: 'provider_status',
    payload: {
      level: 'info',
      message: 'provider request cached',
      wake_id: 'wake_1',
      metadata: {
        provider_request_debug_detail_id: 'prd_1',
        provider_request_debug_url:
          '/v1/chat/sessions/sess_1/provider-requests/prd_1',
        request_sha256: 'abc123',
        request_json_chars: 420,
        expires_at: '2026-07-05T01:00:00Z',
      },
    } as ChatEvent['payload'],
  };
}

function providerDetail(): ProviderRequestDebugDetail {
  return {
    debug_detail_id: 'prd_1',
    session_id: 'sess_1',
    wake_id: 'wake_1',
    provider: {
      brain_module: 'openai-responses',
      model_config_id: 'config-gpt-test',
      endpoint_id: 'endpoint-openai',
      provider_alias: 'main',
      model: 'gpt-test',
      protocol: 'responses',
      provider_kind: 'openai',
    },
    request: {
      value: { model: 'gpt-test', input: [{ role: 'user', content: 'hello' }] },
      truncated: false,
      redacted: true,
    },
    request_sha256: 'abc123',
    request_json_chars: 420,
    recorded_at: '2026-07-05T00:00:00Z',
    expires_at: '2026-07-05T01:00:00Z',
    limits: { max_chars: 4096 },
  };
}

function storageCatalog(): StorageQueryCatalog {
  return {
    schema_version: 1,
    source: 'rust_bridge_read_model',
    items: [
      {
        id: 'runtime.search',
        title: 'Runtime search',
        description: 'Search runtime storage.',
        owner: 'rust_coordination',
        readOnly: true,
        backendAgnostic: true,
        resultShape: 'runtime.search_result.v1',
        parameters: [
          {
            name: 'query',
            type: 'string',
            required: true,
            description: 'Search text.',
          },
        ],
      },
    ],
    total: 1,
  };
}

function trafficItem(): AgentMessageTrafficItem {
  return {
    deliveredModelText:
      '[Rusty Crew routed message: begin]\nexact model-facing text',
    delivery: {
      request: {
        body: 'original payload',
        createdAt: '2026-07-28T09:00:00Z',
        deliveryId: 'delivery-1',
        expiresAt: '2026-07-28T09:05:00Z',
        fromAgentId: 'sender-agent',
        fromSessionId: 'sender-session',
        idempotencyKey: 'idempotency-1',
        inputKind: 'routed_agent_message',
        messageId: 'message-1',
        requestedAddress: '@reviewer',
        requireWake: true,
        toAgentId: 'reviewer-agent',
        toSessionId: 'sess_1',
      },
      status: 'accepted',
      revision: 1,
      resolvedRoundId: 'round-1',
      sequence: 2,
      terminalAt: '2026-07-28T09:00:01Z',
    },
  };
}

async function createPanel(extraProviders: Provider[] = []) {
  const storageResult = signal<StorageQueryResult | null>(null);
  const loadStorageQueryCatalog = vi.fn(async () => undefined);
  const executeStorageQuery = vi.fn(async (queryId: string) => {
    storageResult.set({
      query_id: queryId,
      read_only: true,
      source: 'rust_bridge_read_model',
      items: [{ rowType: 'message', snippet: 'hello' }],
      total: 1,
    });
    return true;
  });
  const loadProvider = vi.fn(async () => providerDetail());
  const trafficResult = signal<{
    deploymentRole: 'production' | 'debug';
    items: readonly AgentMessageTrafficItem[];
  } | null>(null);
  const trafficError = signal<string | null>(null);
  const loadCoordinationMessageTraffic = vi.fn(async () => {
    const item = trafficItem();
    trafficResult.set({ deploymentRole: 'debug', items: [item, item] });
    trafficError.set(null);
    return true;
  });

  await TestBed.configureTestingModule({
    imports: [DebugPanelComponent],
    providers: [
      {
        provide: ChatStore,
        useValue: {
          activeSessionId: () => 'sess_1',
          rawEvents: () => [providerStatusEvent()],
          projection: () => ({ toolCalls: [] }),
          loadProviderRequestDebugDetail: loadProvider,
          loadToolCallDebugDetail: vi.fn(),
        } as unknown as ChatStore,
      },
      {
        provide: AdminStore,
        useValue: {
          loadStorageQueryCatalog,
          executeStorageQuery,
          storageQueryCatalog: () => storageCatalog(),
          storageQueryResult: storageResult.asReadonly(),
          storageQueryLoading: () => false,
          storageQueryError: () => null,
          coordinationMessageTraffic: trafficResult.asReadonly(),
          coordinationMessageTrafficError: trafficError.asReadonly(),
          coordinationMessageTrafficLoading: () => false,
          loadCoordinationMessageTraffic,
        } as unknown as AdminStore,
      },
      {
        provide: WorkerManager,
        useValue: {
          highlightJson: vi.fn(async (json: string) => json),
        },
      },
      ...extraProviders,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DebugPanelComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    loadProvider,
    executeStorageQuery,
    loadCoordinationMessageTraffic,
    trafficResult,
    trafficError,
  };
}

describe('DebugPanelComponent', () => {
  it('composes a downstream Service surface as a Debug tab', async () => {
    const { fixture } = await createPanel([
      {
        provide: CHAT_DEBUG_TABS,
        multi: true,
        useValue: [
          {
            id: 'service-controls',
            label: 'Service',
            order: 40,
            mode: 'controls',
            component: TestServiceControlsComponent,
          },
        ],
      },
    ]);
    const host = fixture.nativeElement as HTMLElement;
    const serviceTab = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Service',
    ) as HTMLButtonElement;

    expect(serviceTab).not.toBeUndefined();
    serviceTab.click();
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="service-controls"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('.rv-debug-panel__subtle')?.textContent,
    ).toContain('runtime diagnostics and controls');
  });

  it('keeps built-in Debug tab ids reserved', async () => {
    const { fixture } = await createPanel([
      {
        provide: CHAT_DEBUG_TABS,
        multi: true,
        useValue: [
          {
            id: 'providers',
            label: 'Replacement Providers',
            component: TestReservedDebugComponent,
          },
        ],
      },
    ]);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Provider Requests');
    expect(host.textContent).not.toContain('Replacement Providers');
    expect(
      host.querySelector('[data-testid="reserved-debug-replacement"]'),
    ).toBeNull();
  });

  it('loads and renders provider request debug details from provider_status metadata', async () => {
    const { fixture, loadProvider } = await createPanel();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('prd_1');
    (
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('prd_1'),
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(loadProvider).toHaveBeenCalledWith('sess_1', 'prd_1');
    expect(host.textContent).toContain('openai-responses');
    expect(host.textContent).toContain('config-gpt-test');
    expect(host.textContent).toContain('endpoint-openai');
    expect(host.textContent).toContain('legacy provider_alias');
    expect(host.textContent).toContain('abc123');
  });

  it('renders the storage query catalog and executes a read-only query', async () => {
    const { fixture, executeStorageQuery } = await createPanel();
    const host = fixture.nativeElement as HTMLElement;

    (
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Storage Queries'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    (
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Run Read-only Query'),
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(executeStorageQuery).toHaveBeenCalledWith('runtime.search', {
      query: 'hello',
    });
    expect(host.textContent).toContain('message');
    expect(host.textContent).toContain('hello');
  });

  it('filters traffic by exact current session and renders one deduplicated receipt', async () => {
    const { fixture, loadCoordinationMessageTraffic } = await createPanel();
    const host = fixture.nativeElement as HTMLElement;
    (
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Message Traffic'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    (
      host.querySelector(
        '[data-testid="coordination-traffic-current-session"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(loadCoordinationMessageTraffic).toHaveBeenCalledWith({
      toSessionId: 'sess_1',
      limit: 100,
    });
    expect(
      host.querySelectorAll('[data-testid="coordination-traffic-item"]'),
    ).toHaveLength(1);
    expect(host.textContent).toContain('sender-agent');
    expect(host.textContent).toContain('@reviewer');
    expect(host.textContent).toContain('original payload');
    expect(host.textContent).toContain('exact model-facing text');
    expect(host.textContent).toContain('round-1');
  });

  it('distinguishes a successful empty traffic query from a request failure', async () => {
    const {
      fixture,
      trafficResult,
      trafficError,
      loadCoordinationMessageTraffic,
    } = await createPanel();
    const host = fixture.nativeElement as HTMLElement;
    (
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Message Traffic'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host.querySelector(
        '[data-testid="coordination-traffic-refresh"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    trafficResult.set({ deploymentRole: 'debug', items: [] });
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="coordination-traffic-empty"]'),
    ).not.toBeNull();

    trafficResult.set(null);
    trafficError.set('debug coordination unavailable');
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="coordination-traffic-error"]')
        ?.textContent,
    ).toContain('debug coordination unavailable');
    expect(loadCoordinationMessageTraffic).toHaveBeenCalledWith({ limit: 100 });
  });
});
