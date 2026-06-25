import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ChatTransport,
  type AdminAgentDiagnostics,
  type AdminControlResponse,
  type AdminDiagnosticsBundle,
  type AdminPage,
  type CreateAdminProfileRequest,
  type CreatedServiceProfile,
  type McpSurfaceDiagnostics,
  type RuntimeBrainModuleDiagnostics,
  type RuntimeConfigApplyResult,
  type RuntimeConfigValidationReport,
  type RuntimeSessionDiagnostics,
} from '@rusty-view/transport';

export interface AdminProfileSummary {
  readonly profileId: string;
  readonly agentIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly activeSessions: number;
  readonly idleSessions: number;
  readonly archivedSessions: number;
  readonly staleSessions: number;
  readonly brainModules: readonly RuntimeBrainModuleDiagnostics[];
  readonly mcpSurfaces: readonly McpSurfaceDiagnostics[];
}

@Injectable()
export class AdminStore {
  private readonly transport = inject(ChatTransport);

  private readonly _diagnostics = signal<AdminDiagnosticsBundle | null>(null);
  private readonly _sessions =
    signal<AdminPage<RuntimeSessionDiagnostics> | null>(null);
  private readonly _agents = signal<AdminPage<AdminAgentDiagnostics> | null>(
    null,
  );
  private readonly _mcpSurfaces =
    signal<AdminPage<McpSurfaceDiagnostics> | null>(null);
  private readonly _configValidation =
    signal<RuntimeConfigValidationReport | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _createResult =
    signal<AdminControlResponse<CreatedServiceProfile> | null>(null);
  private readonly _reloadResult =
    signal<AdminControlResponse<RuntimeConfigApplyResult> | null>(null);

  readonly diagnostics = this._diagnostics.asReadonly();
  readonly sessions = this._sessions.asReadonly();
  readonly agents = this._agents.asReadonly();
  readonly mcpSurfaces = this._mcpSurfaces.asReadonly();
  readonly configValidation = this._configValidation.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();
  readonly createResult = this._createResult.asReadonly();
  readonly reloadResult = this._reloadResult.asReadonly();

  readonly overview = computed(() => this._diagnostics()?.overview ?? null);

  readonly profiles = computed<readonly AdminProfileSummary[]>(() => {
    const sessions = this._sessions()?.items ?? [];
    const agents = this._agents()?.items ?? [];
    const brains = this._diagnostics()?.overview.runtime.brainModules ?? [];
    const mcp = this._mcpSurfaces()?.items ?? [];
    const profileIds = new Set<string>();
    for (const session of sessions) profileIds.add(session.profileId);
    for (const agent of agents) profileIds.add(agent.profileId);
    for (const brain of brains) profileIds.add(brain.profileId);
    for (const surface of mcp) {
      if (surface.profileId !== undefined) profileIds.add(surface.profileId);
    }

    return [...profileIds]
      .sort()
      .map((profileId) =>
        summarizeProfile(profileId, sessions, agents, brains, mcp),
      );
  });

  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [diagnostics, sessions, agents, mcpSurfaces, configValidation] =
        await Promise.all([
          this.transport.adminDiagnostics(),
          this.transport.adminSessions({ limit: 100 }),
          this.transport.adminAgents({ limit: 100 }),
          this.transport.adminMcpSurfaces({ limit: 100 }),
          this.transport.adminConfigValidation(),
        ]);
      this._diagnostics.set(diagnostics);
      this._sessions.set(sessions);
      this._agents.set(agents);
      this._mcpSurfaces.set(mcpSurfaces);
      this._configValidation.set(configValidation);
    } catch (error) {
      this._error.set(errorMessage(error));
    } finally {
      this._loading.set(false);
    }
  }

  async createProfile(request: CreateAdminProfileRequest): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._createResult.set(null);
    try {
      const result = await this.transport.createAdminProfile(request);
      this._createResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(errorMessage(error));
    } finally {
      this._saving.set(false);
    }
  }

  async reloadConfig(): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._reloadResult.set(null);
    try {
      const result = await this.transport.reloadAdminConfig();
      this._reloadResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(errorMessage(error));
    } finally {
      this._saving.set(false);
    }
  }
}

function summarizeProfile(
  profileId: string,
  sessions: readonly RuntimeSessionDiagnostics[],
  agents: readonly AdminAgentDiagnostics[],
  brains: readonly RuntimeBrainModuleDiagnostics[],
  mcp: readonly McpSurfaceDiagnostics[],
): AdminProfileSummary {
  const profileSessions = sessions.filter((s) => s.profileId === profileId);
  const profileAgents = agents.filter((a) => a.profileId === profileId);
  const agentIds = new Set<string>();
  for (const session of profileSessions) agentIds.add(session.agentId);
  for (const agent of profileAgents) agentIds.add(agent.agentId);

  return {
    profileId,
    agentIds: [...agentIds].sort(),
    sessionIds: profileSessions.map((s) => s.sessionId).sort(),
    activeSessions: sumAgentCount(
      profileAgents,
      'activeSessions',
      profileSessions,
    ),
    idleSessions: sumAgentCount(profileAgents, 'idleSessions', profileSessions),
    archivedSessions: sumAgentCount(
      profileAgents,
      'archivedSessions',
      profileSessions,
    ),
    staleSessions: sumAgentCount(
      profileAgents,
      'staleSessions',
      profileSessions,
    ),
    brainModules: brains.filter((b) => b.profileId === profileId),
    mcpSurfaces: mcp.filter((surface) => surface.profileId === profileId),
  };
}

function sumAgentCount(
  agents: readonly AdminAgentDiagnostics[],
  key: 'activeSessions' | 'idleSessions' | 'archivedSessions' | 'staleSessions',
  sessions: readonly RuntimeSessionDiagnostics[],
): number {
  if (agents.length > 0) {
    return agents.reduce((sum, agent) => sum + agent[key], 0);
  }
  const status =
    key === 'activeSessions'
      ? 'active'
      : key === 'idleSessions'
        ? 'idle'
        : key === 'archivedSessions'
          ? 'archived'
          : undefined;
  if (status === undefined) {
    return sessions.filter((session) => session.stale).length;
  }
  return sessions.filter((session) => session.status === status).length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
