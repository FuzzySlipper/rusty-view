import { ChatTransportError, classifyFetchError } from './chat-transport-error';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { HEADER_NAMES } from './chat-routes';
import type {
  AdminAgentDiagnostics,
  AdminApiEnvelope,
  ApiCapabilityRegistry,
  AdminControlResponse,
  AdminDiagnosticsBundle,
  AdminDiagnosticsOverview,
  AdminPage,
  CreateAdminProfileRequest,
  CreatedServiceProfile,
  McpSurfaceDiagnostics,
  RuntimePauseControlRequest,
  RuntimePauseControlResult,
  RuntimeResumeNoopResult,
  RuntimeConfigApplyResult,
  RuntimeConfigValidationReport,
  RuntimePauseScope,
  RuntimeSessionDiagnostics,
} from './admin-api-types';

interface RequestOptions {
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
}

export interface AdminListQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly status?: string;
  readonly profile_id?: string;
}

export class AdminHttpTransport {
  private readonly fetchImpl: FetchImpl;

  constructor(private readonly config: ChatTransportConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  diagnostics(): Promise<AdminDiagnosticsBundle> {
    return this.request('GET', '/v1/admin/diagnostics');
  }

  overview(): Promise<AdminDiagnosticsOverview> {
    return this.request('GET', '/v1/admin/diagnostics/overview');
  }

  sessions(
    query?: AdminListQuery,
  ): Promise<AdminPage<RuntimeSessionDiagnostics>> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/sessions',
      optionsForQuery(query),
    );
  }

  agents(query?: AdminListQuery): Promise<AdminPage<AdminAgentDiagnostics>> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/agents',
      optionsForQuery(query),
    );
  }

  mcpSurfaces(
    query?: AdminListQuery,
  ): Promise<AdminPage<McpSurfaceDiagnostics>> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/mcp',
      optionsForQuery(query),
    );
  }

  configValidation(): Promise<RuntimeConfigValidationReport | null> {
    return this.request('GET', '/v1/admin/diagnostics/config');
  }

  capabilities(): Promise<ApiCapabilityRegistry> {
    return this.request('GET', '/v1/admin/capabilities');
  }

  createProfile(
    request: CreateAdminProfileRequest,
  ): Promise<AdminControlResponse<CreatedServiceProfile>> {
    return this.request('POST', '/v1/admin/control/profiles', {
      body: compactRecord(request),
    });
  }

  reloadConfig(
    reason = 'rusty-view service config reload',
  ): Promise<AdminControlResponse<RuntimeConfigApplyResult>> {
    return this.request('POST', '/v1/admin/control/config/reload', {
      body: { reason },
    });
  }

  pauseRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request: RuntimePauseControlRequest,
  ): Promise<AdminControlResponse<RuntimePauseControlResult>> {
    return this.request('POST', runtimePausePath(scope, targetId, 'pause'), {
      body: compactRecord(request),
    });
  }

  resumeRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request: RuntimePauseControlRequest = {},
  ): Promise<
    AdminControlResponse<RuntimePauseControlResult | RuntimeResumeNoopResult>
  > {
    return this.request('POST', runtimePausePath(scope, targetId, 'resume'), {
      body: compactRecord(request),
    });
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, this.config.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(body: unknown): Headers {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (body !== undefined) {
      headers.set(HEADER_NAMES.contentType, 'application/json');
    }
    if (this.config.bearerToken !== undefined) {
      headers.set(
        HEADER_NAMES.authorization,
        `Bearer ${this.config.bearerToken}`,
      );
    }
    return headers;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const init: RequestInit = {
      method,
      headers: this.buildHeaders(options.body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw classifyFetchError(error);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ChatTransportError({
        code: 'envelope_error',
        message: `Admin API returned non-JSON response (${response.status}).`,
        statusCode: response.status,
      });
    }

    const envelope = json as AdminApiEnvelope<T>;
    if (response.ok && envelope.ok === true) {
      return envelope.data;
    }
    if (envelope.ok === false) {
      throw new ChatTransportError({
        code:
          envelope.error.code === 'unauthorized' ||
          envelope.error.code === 'forbidden'
            ? 'auth_error'
            : 'http_error',
        message: envelope.error.message,
        statusCode: response.status,
        apiError: envelope.error,
      });
    }

    throw new ChatTransportError({
      code: 'envelope_error',
      message: 'Admin API response did not match the expected envelope.',
      statusCode: response.status,
    });
  }
}

function optionsForQuery(query?: AdminListQuery): RequestOptions {
  return query === undefined ? {} : { query: { ...query } };
}

function compactRecord(value: object): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== '') {
      next[key] = entry;
    }
  }
  return next;
}

function runtimePausePath(
  scope: RuntimePauseScope,
  targetId: string,
  action: 'pause' | 'resume',
): string {
  const family =
    scope === 'session'
      ? 'sessions'
      : scope === 'profile'
        ? 'profiles'
        : 'agents';
  const targetKey =
    scope === 'session'
      ? 'session_id'
      : scope === 'profile'
        ? 'profile_id'
        : 'agent_id';
  return `/v1/admin/control/${family}/{${targetKey}}/runtime/${action}`.replace(
    `{${targetKey}}`,
    encodeURIComponent(targetId),
  );
}
