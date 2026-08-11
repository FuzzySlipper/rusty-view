import type {
  ApiError,
  ArchiveExternalRuntimeThreadResponse,
  CreateExternalAgentSessionResponse,
  DeleteExternalRuntimeThreadResponse,
  ExternalAgentBinding,
  ExternalAgentSessionCreateResult,
  ExternalAgentSessionCreateWrite,
  ExternalBindingFleet,
  ExternalBindingMessageWrite,
  ExternalBindingMetadataWrite,
  ExternalBindingProfileRefreshWrite,
  ExternalBindingRestoreWrite,
  ExternalControlReceipt,
  ExternalControlWrite,
  ExternalInteractionAttention,
  ExternalInteractionRecord,
  ExternalInteractionResolutionWrite,
  ExternalRuntimeEventPage,
  ExternalRuntimeEventHead,
  ExternalRuntimeFleet,
  ExternalRuntimeRawDetail,
  ExternalRuntimeCommandCatalog,
  ExternalRuntimeCommandExecutionResult,
  ExternalRuntimeCommandWrite,
  ExternalThreadPage,
  ExternalThreadReadRequest,
  ExternalThreadReadResult,
  ListExternalBindingsResponse,
  ListExternalInteractionsResponse,
  ListExternalBindingCommandsResponse,
  ListExternalRuntimeEventsResponse,
  ReadExternalRuntimeEventHeadResponse,
  ListExternalRuntimeThreadsResponse,
  ListExternalRuntimesResponse,
  ReadExternalRuntimeRawDetailResponse,
  ReadExternalRuntimeThreadResponse,
  ResolveExternalInteractionResponse,
  RestoreExternalBindingResponse,
  RefreshExternalBindingProfileResponse,
  ExecuteExternalBindingCommandResponse,
  SendExternalBindingMessageResponse,
  SubmitExternalBindingControlResponse,
  UnarchiveExternalRuntimeThreadResponse,
  WriteExternalBindingMetadataResponse,
} from '@rusty-view/protocol';

import { ChatTransportError, classifyFetchError } from './chat-transport-error';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';

type SuccessEnvelope<T> = { readonly ok: true; readonly data: T };

export class ExternalRuntimeHttpTransport {
  private readonly fetchImpl: FetchImpl;

  constructor(private readonly config: ChatTransportConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async listRuntimes(): Promise<ExternalRuntimeFleet> {
    return unwrap(
      await this.request<ListExternalRuntimesResponse>(
        'GET',
        '/v1/external-runtimes',
      ),
    );
  }

  async createAgentSession(
    request: ExternalAgentSessionCreateWrite,
  ): Promise<ExternalAgentSessionCreateResult> {
    return unwrap(
      await this.request<CreateExternalAgentSessionResponse>(
        'POST',
        '/v1/external-agent-sessions',
        request,
      ),
    );
  }

  async listBindings(): Promise<ExternalBindingFleet> {
    return unwrap(
      await this.request<ListExternalBindingsResponse>(
        'GET',
        '/v1/external-bindings',
      ),
    );
  }

  async updateBindingMetadata(
    bindingId: string,
    request: ExternalBindingMetadataWrite,
  ): Promise<ExternalAgentBinding> {
    return unwrap(
      await this.request<WriteExternalBindingMetadataResponse>(
        'POST',
        `/v1/external-bindings/${encodeURIComponent(bindingId)}/metadata`,
        request,
      ),
    );
  }

  async restoreBinding(
    bindingId: string,
    request: ExternalBindingRestoreWrite,
  ): Promise<RestoreExternalBindingResponse['data']> {
    return unwrap(
      await this.request<RestoreExternalBindingResponse>(
        'POST',
        `/v1/external-bindings/${encodeURIComponent(bindingId)}/restore`,
        request,
      ),
    );
  }

  async refreshBindingProfile(
    bindingId: string,
    request: ExternalBindingProfileRefreshWrite,
  ): Promise<RefreshExternalBindingProfileResponse['data']> {
    return unwrap(
      await this.request<RefreshExternalBindingProfileResponse>(
        'POST',
        `/v1/external-bindings/${encodeURIComponent(bindingId)}/profile-refresh`,
        request,
      ),
    );
  }

  async listThreads(
    runtimeId: string,
    query?: {
      readonly limit?: number;
      readonly cursor?: string;
      readonly archived?: boolean;
    },
  ): Promise<ExternalThreadPage> {
    return unwrap(
      await this.request<ListExternalRuntimeThreadsResponse>(
        'GET',
        `/v1/external-runtimes/${encodeURIComponent(runtimeId)}/threads`,
        undefined,
        query,
      ),
    );
  }

  async archiveThread(
    runtimeId: string,
    threadId: string,
  ): Promise<ArchiveExternalRuntimeThreadResponse['data']> {
    return unwrap(
      await this.request<ArchiveExternalRuntimeThreadResponse>(
        'POST',
        threadLifecyclePath(runtimeId, threadId, 'archive'),
      ),
    );
  }

  async unarchiveThread(
    runtimeId: string,
    threadId: string,
  ): Promise<UnarchiveExternalRuntimeThreadResponse['data']> {
    return unwrap(
      await this.request<UnarchiveExternalRuntimeThreadResponse>(
        'POST',
        threadLifecyclePath(runtimeId, threadId, 'unarchive'),
      ),
    );
  }

  async deleteThread(
    runtimeId: string,
    threadId: string,
  ): Promise<DeleteExternalRuntimeThreadResponse['data']> {
    return unwrap(
      await this.request<DeleteExternalRuntimeThreadResponse>(
        'POST',
        threadLifecyclePath(runtimeId, threadId, 'delete'),
      ),
    );
  }

  async readThread(
    runtimeId: string,
    request: ExternalThreadReadRequest,
  ): Promise<ExternalThreadReadResult> {
    return unwrap(
      await this.request<ReadExternalRuntimeThreadResponse>(
        'POST',
        `/v1/external-runtimes/${encodeURIComponent(runtimeId)}/threads/read`,
        request,
        undefined,
        this.config.timeoutMs,
      ),
    );
  }

  async listEvents(
    runtimeId: string,
    query?: {
      readonly after?: number;
      readonly limit?: number;
      readonly nativeThreadId?: string;
    },
  ): Promise<ExternalRuntimeEventPage> {
    return unwrap(
      await this.request<ListExternalRuntimeEventsResponse>(
        'GET',
        `/v1/external-runtimes/${encodeURIComponent(runtimeId)}/events`,
        undefined,
        query === undefined
          ? undefined
          : {
              ...(query.after === undefined ? {} : { after: query.after }),
              ...(query.limit === undefined ? {} : { limit: query.limit }),
              ...(query.nativeThreadId === undefined
                ? {}
                : { native_thread_id: query.nativeThreadId }),
            },
      ),
    );
  }

  async readEventHead(runtimeId: string): Promise<ExternalRuntimeEventHead> {
    return unwrap(
      await this.request<ReadExternalRuntimeEventHeadResponse>(
        'GET',
        `/v1/external-runtimes/${encodeURIComponent(runtimeId)}/events/head`,
      ),
    );
  }

  async listInteractions(): Promise<ExternalInteractionAttention> {
    return unwrap(
      await this.request<ListExternalInteractionsResponse>(
        'GET',
        '/v1/external-interactions',
      ),
    );
  }

  async submitControl(
    bindingId: string,
    request: ExternalControlWrite,
  ): Promise<ExternalControlReceipt> {
    return unwrap(
      await this.request<SubmitExternalBindingControlResponse>(
        'POST',
        `/v1/external-bindings/${encodeURIComponent(bindingId)}/controls`,
        request,
      ),
    );
  }

  async sendMessage(
    bindingId: string,
    request: ExternalBindingMessageWrite,
  ): Promise<SendExternalBindingMessageResponse['data']> {
    return unwrap(
      await this.request<SendExternalBindingMessageResponse>(
        'POST',
        `/v1/external-bindings/${encodeURIComponent(bindingId)}/messages`,
        request,
      ),
    );
  }

  async listCommands(
    bindingId: string,
  ): Promise<ExternalRuntimeCommandCatalog> {
    return unwrap(
      await this.request<ListExternalBindingCommandsResponse>(
        'GET',
        externalBindingCommandsPath(bindingId),
      ),
    );
  }

  async executeCommand(
    bindingId: string,
    request: ExternalRuntimeCommandWrite,
  ): Promise<ExternalRuntimeCommandExecutionResult> {
    return unwrap(
      await this.request<ExecuteExternalBindingCommandResponse>(
        'POST',
        externalBindingCommandsPath(bindingId),
        request,
      ),
    );
  }

  async resolveInteraction(
    interactionId: string,
    request: ExternalInteractionResolutionWrite,
  ): Promise<ExternalInteractionRecord> {
    return unwrap(
      await this.request<ResolveExternalInteractionResponse>(
        'POST',
        `/v1/external-interactions/${encodeURIComponent(interactionId)}/resolve`,
        request,
      ),
    );
  }

  async rawDetail(
    runtimeId: string,
    detailId: string,
  ): Promise<ExternalRuntimeRawDetail> {
    return unwrap(
      await this.request<ReadExternalRuntimeRawDetailResponse>(
        'GET',
        `/v1/external-runtimes/${encodeURIComponent(runtimeId)}/raw-details/${encodeURIComponent(detailId)}`,
      ),
    );
  }

  streamUrl(runtimeId: string, cursor?: number): string {
    const url = new URL(
      `/v1/external-runtimes/${encodeURIComponent(runtimeId)}/stream`,
      this.config.baseUrl,
    );
    if (cursor !== undefined) url.searchParams.set('cursor', String(cursor));
    return url.toString();
  }

  streamHeaders(cursor?: number): Headers {
    const headers = new Headers({ Accept: 'text/event-stream' });
    if (this.config.bearerToken !== undefined) {
      headers.set('Authorization', `Bearer ${this.config.bearerToken}`);
    }
    if (cursor !== undefined) headers.set('Last-Event-ID', String(cursor));
    return headers;
  }

  fetch(): FetchImpl {
    return this.fetchImpl;
  }

  private async request<T extends SuccessEnvelope<unknown>>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Readonly<Record<string, unknown>>,
    timeoutMs = method === 'GET'
      ? this.config.timeoutMs
      : this.config.writeTimeoutMs,
  ): Promise<T> {
    // External JSON reads, including event bootstrap and session reads, are
    // bounded by the short read deadline. Agent-waking writes use the
    // deliberately longer write deadline; a zero write timeout preserves the
    // configured unbounded-write behavior without weakening read safety.
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.config.bearerToken !== undefined) {
      headers.set('Authorization', `Bearer ${this.config.bearerToken}`);
    }
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout =
      controller === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              const error = new Error('Request timed out');
              error.name = 'TimeoutError';
              controller.abort(error);
              reject(error);
            }, timeoutMs);
          });

    try {
      const request = this.fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(controller === undefined ? {} : { signal: controller.signal }),
      });
      const response =
        timeout === undefined
          ? await request
          : await Promise.race([request, timeout]);
      const responseBody = response.json();
      const parsed =
        timeout === undefined
          ? await responseBody
          : await Promise.race([responseBody, timeout]);
      if (!response.ok || !isSuccessEnvelope(parsed)) {
        const apiError = apiErrorFromEnvelope(parsed);
        throw new ChatTransportError({
          code:
            response.status === 401 || response.status === 403
              ? 'auth_error'
              : 'http_error',
          message: apiError?.message ?? errorMessage(parsed, response),
          statusCode: response.status,
          endpoint: path,
          ...(apiError === undefined ? {} : { apiError }),
        });
      }
      return parsed as T;
    } catch (error) {
      throw classifyFetchError(error);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}

function threadLifecyclePath(
  runtimeId: string,
  threadId: string,
  action: 'archive' | 'unarchive' | 'delete',
): string {
  return `/v1/external-runtimes/${encodeURIComponent(runtimeId)}/threads/${encodeURIComponent(threadId)}/${action}`;
}

function externalBindingCommandsPath(bindingId: string): string {
  return `/v1/external-bindings/${encodeURIComponent(bindingId)}/commands`;
}

function unwrap<T>(envelope: SuccessEnvelope<T>): T {
  return envelope.data;
}

function isSuccessEnvelope(value: unknown): value is SuccessEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === true &&
    'data' in value
  );
}

function errorMessage(value: unknown, response: Response): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  ) {
    return value.error.message;
  }
  return `External runtime request failed: HTTP ${response.status}`;
}

function apiErrorFromEnvelope(value: unknown): ApiError | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('error' in value) ||
    typeof value.error !== 'object' ||
    value.error === null
  ) {
    return undefined;
  }
  const error = value.error as Record<string, unknown>;
  return typeof error['code'] === 'string' &&
    typeof error['reason_code'] === 'string' &&
    typeof error['message'] === 'string' &&
    typeof error['retryable'] === 'boolean'
    ? (error as unknown as ApiError)
    : undefined;
}

export type ExternalBinding = ExternalAgentBinding;
