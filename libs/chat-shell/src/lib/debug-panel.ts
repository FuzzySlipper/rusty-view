import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { JsonInspectorComponent } from '@rusty-view/chat-components';
import { AdminStore, ChatStore } from '@rusty-view/chat-store';
import type {
  ProviderRequestDebugDetail,
  ToolCallDebugDetail,
} from '@rusty-view/protocol';
import type {
  StorageQueryDescriptor,
  StorageQueryParameter,
  StorageQueryResult,
} from '@rusty-view/transport';
import { CHAT_DEBUG_TABS, type ChatDebugTab } from './shell-extension-tokens';

const BUILT_IN_DEBUG_TABS = [
  { id: 'providers', label: 'Provider Requests', order: 10 },
  { id: 'tools', label: 'Tool Calls', order: 20 },
  { id: 'storage', label: 'Storage Queries', order: 30 },
] as const;
const BUILT_IN_DEBUG_TAB_IDS = new Set<string>(
  BUILT_IN_DEBUG_TABS.map((tab) => tab.id),
);

interface DebugTabDescriptor {
  readonly id: string;
  readonly label: string;
  readonly order: number;
}

interface ProviderRequestEntry {
  readonly eventId: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly wakeId: string | undefined;
  readonly debugDetailId: string;
  readonly debugUrl: string | undefined;
  readonly requestSha256: string | undefined;
  readonly requestJsonChars: number | undefined;
  readonly expiresAt: string | undefined;
  readonly message: string | undefined;
}

interface ToolDebugEntry {
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: string;
  readonly summary: string;
  readonly debugDetailId: string;
  readonly eventId: string;
  readonly createdAt: string;
}

@Component({
  selector: 'rv-debug-panel',
  imports: [JsonInspectorComponent, NgComponentOutlet],
  templateUrl: './debug-panel.html',
  styleUrl: './debug-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebugPanelComponent {
  protected readonly store = inject(ChatStore);
  protected readonly admin = inject(AdminStore);
  private readonly providedTabs = inject(CHAT_DEBUG_TABS, { optional: true });

  protected readonly activeTab = signal<string>('providers');
  protected readonly selectedStorageQueryId = signal<string | null>(null);
  protected readonly storageInputs = signal<Record<string, string>>({});
  protected readonly providerLoadingId = signal<string | null>(null);
  protected readonly providerError = signal<string | null>(null);
  protected readonly providerDetail = signal<ProviderRequestDebugDetail | null>(
    null,
  );
  protected readonly toolLoadingId = signal<string | null>(null);
  protected readonly toolError = signal<string | null>(null);
  protected readonly toolDetail = signal<ToolCallDebugDetail | null>(null);

  protected readonly customTabs = computed<readonly ChatDebugTab[]>(() => {
    const merged = new Map<string, ChatDebugTab>();
    for (const tab of flattenDebugTabProviders(this.providedTabs)) {
      if (BUILT_IN_DEBUG_TAB_IDS.has(tab.id)) continue;
      merged.set(tab.id, tab);
    }
    return [...merged.values()].sort(
      (left, right) =>
        (left.order ?? 100) - (right.order ?? 100) ||
        left.id.localeCompare(right.id),
    );
  });

  protected readonly tabs = computed<readonly DebugTabDescriptor[]>(() =>
    [
      ...BUILT_IN_DEBUG_TABS,
      ...this.customTabs().map((tab) => ({
        id: tab.id,
        label: tab.label,
        order: tab.order ?? 100,
      })),
    ].sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    ),
  );

  protected readonly activeCustomTab = computed<ChatDebugTab | undefined>(() =>
    this.customTabs().find((tab) => tab.id === this.activeTab()),
  );

  protected readonly providerEntries = computed<
    readonly ProviderRequestEntry[]
  >(() =>
    this.store
      .rawEvents()
      .filter((event) => event.kind === 'provider_status')
      .map(providerRequestEntryFromEvent)
      .filter((entry): entry is ProviderRequestEntry => entry !== null)
      .reverse(),
  );

  protected readonly toolEntries = computed<readonly ToolDebugEntry[]>(() =>
    this.store
      .projection()
      .toolCalls.filter((tool) => tool.debugDetailId !== undefined)
      .map((tool) => ({
        sessionId: this.store.activeSessionId() ?? '',
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        status: tool.status,
        summary: tool.summary,
        debugDetailId: tool.debugDetailId as string,
        eventId: tool.eventId,
        createdAt: tool.createdAt,
      }))
      .reverse(),
  );

  protected readonly storageQueries = computed<
    readonly StorageQueryDescriptor[]
  >(() => this.admin.storageQueryCatalog()?.items ?? []);

  protected readonly selectedStorageQuery =
    computed<StorageQueryDescriptor | null>(() => {
      const id = this.selectedStorageQueryId() ?? this.storageQueries()[0]?.id;
      if (id === undefined) return null;
      return this.storageQueries().find((query) => query.id === id) ?? null;
    });

  protected readonly storageResult = computed<StorageQueryResult | null>(() =>
    this.admin.storageQueryResult(),
  );

  protected readonly storageRows = computed<readonly Record<string, unknown>[]>(
    () =>
      (this.storageResult()?.items ?? []).filter(isRecord) as readonly Record<
        string,
        unknown
      >[],
  );

  protected readonly storageColumns = computed<readonly string[]>(() => {
    const columns = new Set<string>();
    for (const row of this.storageRows().slice(0, 20)) {
      for (const key of Object.keys(row)) columns.add(key);
    }
    return [...columns].slice(0, 8);
  });

  constructor() {
    void this.admin.loadStorageQueryCatalog();
  }

  protected selectTab(tab: string): void {
    this.activeTab.set(tab);
  }

  protected async loadProviderDetail(
    entry: ProviderRequestEntry,
  ): Promise<void> {
    this.providerLoadingId.set(entry.debugDetailId);
    this.providerError.set(null);
    this.providerDetail.set(null);
    try {
      this.providerDetail.set(
        await this.store.loadProviderRequestDebugDetail(
          entry.sessionId,
          entry.debugDetailId,
        ),
      );
    } catch (error) {
      this.providerError.set(errorMessage(error));
    } finally {
      this.providerLoadingId.set(null);
    }
  }

  protected async loadToolDetail(entry: ToolDebugEntry): Promise<void> {
    this.toolLoadingId.set(entry.debugDetailId);
    this.toolError.set(null);
    this.toolDetail.set(null);
    try {
      this.toolDetail.set(
        await this.store.loadToolCallDebugDetail(
          entry.sessionId,
          entry.debugDetailId,
        ),
      );
    } catch (error) {
      this.toolError.set(errorMessage(error));
    } finally {
      this.toolLoadingId.set(null);
    }
  }

  protected selectStorageQuery(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedStorageQueryId.set(select.value);
    this.storageInputs.set({});
  }

  protected updateStorageInput(
    parameter: StorageQueryParameter,
    event: Event,
  ): void {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    this.storageInputs.update((current) => ({
      ...current,
      [parameter.name]: input.value,
    }));
  }

  protected async runStorageQuery(): Promise<void> {
    const query = this.selectedStorageQuery();
    if (query === null) return;
    await this.admin.executeStorageQuery(
      query.id,
      storageInputFor(query, this.storageInputs()),
    );
  }

  protected storageInputValue(parameter: StorageQueryParameter): string {
    const value = this.storageInputs()[parameter.name];
    if (value !== undefined) return value;
    return parameter.defaultValue === undefined
      ? ''
      : String(parameter.defaultValue);
  }

  protected storageInputId(parameter: StorageQueryParameter): string {
    return `storage-query-param-${parameter.name.replace(/[^\w-]/g, '-')}`;
  }

  protected valueLabel(value: unknown): string {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  protected expiredLabel(expiresAt: string | undefined): string {
    if (expiresAt === undefined) return 'expiry unknown';
    return new Date(expiresAt).getTime() <= Date.now() ? 'expired' : expiresAt;
  }
}

function flattenDebugTabProviders(
  provided: readonly ChatDebugTab[] | null,
): readonly ChatDebugTab[] {
  const flattened: ChatDebugTab[] = [];
  for (const entry of (provided ?? []) as readonly unknown[]) {
    if (Array.isArray(entry)) {
      flattened.push(...(entry as readonly ChatDebugTab[]));
    } else {
      flattened.push(entry as ChatDebugTab);
    }
  }
  return flattened;
}

function providerRequestEntryFromEvent(
  event: ReturnType<ChatStore['rawEvents']>[number],
): ProviderRequestEntry | null {
  const payload = isRecord(event.payload) ? event.payload : {};
  const metadata = metadataRecord(payload);
  const debugDetailId = readString(
    metadata,
    'provider_request_debug_detail_id',
  );
  if (debugDetailId === undefined) return null;
  return {
    eventId: event.event_id,
    sessionId: event.session_id,
    createdAt: event.created_at,
    wakeId: readString(payload, 'wake_id') ?? readString(metadata, 'wake_id'),
    debugDetailId,
    debugUrl: readString(metadata, 'provider_request_debug_url'),
    requestSha256: readString(metadata, 'request_sha256'),
    requestJsonChars: readNumber(metadata, 'request_json_chars'),
    expiresAt: readString(metadata, 'expires_at'),
    message: readString(payload, 'message'),
  };
}

function metadataRecord(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const direct = payload['metadata'];
  if (isRecord(direct)) return direct;
  const json = payload['metadata_json'];
  if (isRecord(json)) return json;
  return payload;
}

function storageInputFor(
  query: StorageQueryDescriptor,
  values: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const parameter of query.parameters) {
    const raw = values[parameter.name] ?? '';
    if (raw === '' && parameter.defaultValue === undefined) continue;
    const value = raw === '' ? parameter.defaultValue : raw;
    if (value === undefined) continue;
    input[parameter.name] = coerceStorageValue(parameter, value);
  }
  return input;
}

function coerceStorageValue(
  parameter: StorageQueryParameter,
  value: unknown,
): unknown {
  if (parameter.type === 'integer') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : value;
  }
  if (parameter.type === 'boolean') {
    return value === true || value === 'true';
  }
  return value;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
