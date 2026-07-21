import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  AgentDirectoryEntry,
  AgentRouteRecord,
  AgentRouteResolution,
  ExternalAgentBinding,
} from '@rusty-view/protocol';
import {
  ChatTransport,
  type CoordinationDeliveryResult,
  type CoordinationDeploymentRole,
  type CoordinationRoundResult,
  type CoordinationRouteTestRequest,
  type CoordinationRouteWriteRequest,
} from '@rusty-view/transport';
import {
  buildSwitchboardTargetOptions,
  deliveryOutcome,
  normalizeSwitchboardOutcome,
  projectSwitchboardRouteRows,
  type SwitchboardOutcomeKind,
} from './switchboard-model';
import {
  storeErrorDetail,
  storeErrorDetailMessage,
  type StoreErrorDetail,
} from './store-error';

export interface SwitchboardActionResult {
  readonly kind: 'resolve' | 'delivery' | 'round' | 'write' | 'delete';
  readonly address: string;
  readonly outcome: SwitchboardOutcomeKind;
  readonly summary: string;
  readonly reasonCode?: string;
  readonly resolution?: AgentRouteResolution;
  readonly delivery?: CoordinationDeliveryResult;
  readonly round?: CoordinationRoundResult;
  readonly route?: AgentRouteRecord;
}

@Injectable()
export class SwitchboardStore {
  private readonly transport = inject(ChatTransport);
  private readonly _deploymentRole = signal<CoordinationDeploymentRole | null>(
    null,
  );
  private readonly _agents = signal<readonly AgentDirectoryEntry[]>([]);
  private readonly _bindings = signal<readonly ExternalAgentBinding[]>([]);
  private readonly _resolutions = signal<readonly AgentRouteResolution[]>([]);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<StoreErrorDetail | null>(null);
  private readonly _lastAction = signal<SwitchboardActionResult | null>(null);

  readonly deploymentRole = this._deploymentRole.asReadonly();
  readonly serviceBaseUrl = this.transport.getConfig().baseUrl;
  readonly agents = this._agents.asReadonly();
  readonly bindings = this._bindings.asReadonly();
  readonly resolutions = this._resolutions.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly errorDetail = this._error.asReadonly();
  readonly error = computed(() => {
    const error = this._error();
    return error === null ? null : storeErrorDetailMessage(error);
  });
  readonly lastAction = this._lastAction.asReadonly();
  readonly targetOptions = computed(() =>
    buildSwitchboardTargetOptions(this._agents(), this._bindings()),
  );
  readonly rows = computed(() =>
    projectSwitchboardRouteRows(this._resolutions(), this.targetOptions()),
  );

  async refresh(): Promise<boolean> {
    if (this._loading()) return false;
    this._loading.set(true);
    this._error.set(null);
    try {
      const directory = await this.transport.coordinationAgentDirectory();
      const [routes, bindingFleet] = await Promise.all([
        this.transport.coordinationRoutes(directory.deploymentRole),
        this.transport.external.listBindings(),
      ]);
      if (routes.deploymentRole !== directory.deploymentRole) {
        throw new Error(
          `Crew coordination role changed from ${directory.deploymentRole} to ${routes.deploymentRole}`,
        );
      }
      this._deploymentRole.set(directory.deploymentRole);
      this._agents.set(directory.agents);
      this._bindings.set(bindingFleet.bindings);
      this._resolutions.set(routes.routes);
      return true;
    } catch (error) {
      this._error.set(storeErrorDetail(error));
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  async createRoute(request: CoordinationRouteWriteRequest): Promise<boolean> {
    const role = this.requireRole();
    if (role === null) return false;
    return this.runWrite(async () => {
      const result = await this.transport.coordinationCreateRoute(
        role,
        request,
      );
      this.assertRole(result.deploymentRole, role);
      this._lastAction.set({
        kind: 'write',
        address: `@${result.route.routeKey}`,
        outcome:
          result.resolution?.routable === false ? 'rejected' : 'accepted',
        summary: `Created @${result.route.routeKey} at revision ${result.route.revision}.`,
        route: result.route,
        ...(result.resolution === undefined || result.resolution === null
          ? {}
          : { resolution: result.resolution }),
      });
    });
  }

  async updateRoute(
    routeKey: string,
    request: CoordinationRouteWriteRequest,
  ): Promise<boolean> {
    const role = this.requireRole();
    if (role === null) return false;
    return this.runWrite(async () => {
      const result = await this.transport.coordinationUpdateRoute(
        role,
        routeKey,
        request,
      );
      this.assertRole(result.deploymentRole, role);
      this._lastAction.set({
        kind: 'write',
        address: `@${routeKey}`,
        outcome:
          result.resolution?.routable === false ? 'rejected' : 'accepted',
        summary: `Saved @${routeKey} at revision ${result.route.revision}.`,
        route: result.route,
        ...(result.resolution === undefined || result.resolution === null
          ? {}
          : { resolution: result.resolution }),
      });
    });
  }

  async deleteRoute(route: AgentRouteRecord): Promise<boolean> {
    const role = this.requireRole();
    if (role === null) return false;
    return this.runWrite(async () => {
      const result = await this.transport.coordinationDeleteRoute(
        role,
        route.routeKey,
        route.revision,
      );
      this.assertRole(result.deploymentRole, role);
      this._lastAction.set({
        kind: 'delete',
        address: `@${route.routeKey}`,
        outcome: 'accepted',
        summary: `Deleted @${route.routeKey} revision ${route.revision}.`,
        route: result.route,
      });
    });
  }

  async resolveAddress(address: string): Promise<boolean> {
    const role = this.requireRole();
    if (role === null) return false;
    return this.runAction(async () => {
      const result = await this.transport.coordinationResolveAddress(
        role,
        address,
      );
      this.assertRole(result.deploymentRole, role);
      this._lastAction.set({
        kind: 'resolve',
        address,
        outcome: result.resolution.routable ? 'accepted' : 'rejected',
        summary: result.resolution.routable
          ? `${address} resolves to ${result.resolution.resolvedTarget?.agentId ?? 'unknown'} / ${result.resolution.resolvedTarget?.sessionId ?? 'unknown'}.`
          : `${address} is not routable.`,
        ...(result.resolution.reasonCode
          ? { reasonCode: result.resolution.reasonCode }
          : {}),
        resolution: result.resolution,
      });
    });
  }

  async testDelivery(
    routeKey: string,
    request: CoordinationRouteTestRequest,
  ): Promise<boolean> {
    const role = this.requireRole();
    if (role === null) return false;
    return this.runAction(async () => {
      const result = await this.transport.coordinationTestRoute(
        role,
        routeKey,
        request,
      );
      this.assertRole(result.deploymentRole, role);
      const outcome = deliveryOutcome(result.delivery);
      this._lastAction.set({
        kind: 'delivery',
        address: `@${routeKey}`,
        outcome,
        summary: `Test delivery ${result.deliveryId}: ${outcome}.`,
        ...(result.terminalReason ? { reasonCode: result.terminalReason } : {}),
        delivery: result,
      });
    });
  }

  async testRound(
    routeKey: string,
    body: string,
    ttlMs: number,
  ): Promise<boolean> {
    const role = this.requireRole();
    if (role === null) return false;
    return this.runAction(async () => {
      let result = await this.transport.coordinationStartRound(role, {
        toAddress: `@${routeKey}`,
        body,
        ttlMs,
      });
      this.assertRole(result.deploymentRole, role);
      const deadline = Date.now() + ttlMs + 2_000;
      while (result.status === 'pending' && Date.now() < deadline) {
        await wait(250);
        result = await this.transport.coordinationRound(role, result.roundId);
        this.assertRole(result.deploymentRole, role);
      }
      const outcome =
        result.status === 'pending'
          ? 'no_reply'
          : normalizeSwitchboardOutcome(
              result.status,
              result.terminalReason ?? result.round.terminalReasonCode,
            );
      const reasonCode =
        result.terminalReason ?? result.round.terminalReasonCode ?? undefined;
      this._lastAction.set({
        kind: 'round',
        address: `@${routeKey}`,
        outcome,
        summary:
          outcome === 'replied'
            ? roundReplySummary(result)
            : `Test round ${result.roundId}: ${outcome}.`,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        round: result,
      });
    });
  }

  private requireRole(): CoordinationDeploymentRole | null {
    const role = this._deploymentRole();
    if (role === null) {
      this._error.set(
        storeErrorDetail(
          new Error('Refresh the switchboard before performing an operation.'),
        ),
      );
    }
    return role;
  }

  private assertRole(
    actual: CoordinationDeploymentRole,
    expected: CoordinationDeploymentRole,
  ): void {
    if (actual !== expected) {
      throw new Error(
        `Crew coordination write expected ${expected} but service reported ${actual}`,
      );
    }
  }

  private async runWrite(operation: () => Promise<void>): Promise<boolean> {
    const saved = await this.runAction(operation);
    if (saved) await this.refresh();
    return saved;
  }

  private async runAction(operation: () => Promise<void>): Promise<boolean> {
    if (this._saving()) return false;
    this._saving.set(true);
    this._error.set(null);
    try {
      await operation();
      return true;
    } catch (error) {
      this._error.set(storeErrorDetail(error));
      return false;
    } finally {
      this._saving.set(false);
    }
  }
}

function roundReplySummary(result: CoordinationRoundResult): string {
  const outcome = result.round.outcome;
  if (
    outcome !== null &&
    typeof outcome === 'object' &&
    !Array.isArray(outcome)
  ) {
    const body = (outcome as Record<string, unknown>)['body'];
    if (typeof body === 'string' && body.trim().length > 0) {
      return `Reply: ${body}`;
    }
  }
  return `Test round ${result.roundId}: replied.`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
