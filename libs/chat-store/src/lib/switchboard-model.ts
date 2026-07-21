import type {
  AgentDirectoryEntry,
  AgentMessageDeliveryReceipt,
  AgentRouteResolution,
  AgentRouteTarget,
  ExternalAgentBinding,
  ExternalMessageDeliveryPolicy,
} from '@rusty-view/protocol';
import type { CoordinationRouteWriteRequest } from '@rusty-view/transport';

export type SwitchboardOutcomeKind =
  | 'pending'
  | 'accepted'
  | 'queued'
  | 'replied'
  | 'no_reply'
  | 'expired'
  | 'rejected'
  | 'failed';

export interface SwitchboardTargetOption {
  readonly key: string;
  readonly target: AgentRouteTarget;
  readonly runtimeKind: 'direct_brain' | 'codex_app_server';
  readonly agent: AgentDirectoryEntry;
  readonly binding?: ExternalAgentBinding;
  readonly selectable: boolean;
  readonly reasonCode?: string;
  readonly duplicateIdentity: boolean;
  readonly summary: string;
}

export interface SwitchboardRouteDraft {
  readonly routeKey: string;
  readonly label: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly targetKey: string;
  readonly requiredDeliveryPolicy: ExternalMessageDeliveryPolicy | null;
  readonly expectedRevision?: number;
}

export interface SwitchboardDraftValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly target?: SwitchboardTargetOption;
  readonly request?: CoordinationRouteWriteRequest;
}

export interface SwitchboardRouteRow {
  readonly address: string;
  readonly routeKey: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly routable: boolean;
  readonly reasonCode?: string;
  readonly runtimeKind: string;
  readonly profileId: string;
  readonly displayLabel: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly bindingId?: string;
  readonly bindingRevision?: number;
  readonly deliveryPolicy?: string;
  readonly revision: number;
  readonly lastOutcome?: SwitchboardOutcomeKind;
  readonly lastReasonCode?: string;
  readonly resolution: AgentRouteResolution;
}

export function buildSwitchboardTargetOptions(
  agents: readonly AgentDirectoryEntry[],
  bindings: readonly ExternalAgentBinding[],
): readonly SwitchboardTargetOption[] {
  const identityCounts = new Map<string, number>();
  for (const agent of agents) {
    const identity = `${agent.profileId}\u0000${agent.displayLabel}`;
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }

  return agents.map((agent) => {
    const duplicateIdentity =
      (identityCounts.get(`${agent.profileId}\u0000${agent.displayLabel}`) ??
        0) > 1;
    if (agent.runtimeKind === 'direct_brain') {
      const target: AgentRouteTarget = {
        type: 'direct_brain',
        agentId: agent.agentId,
        sessionId: agent.sessionId,
      };
      return {
        key: targetKey(target),
        target,
        runtimeKind: agent.runtimeKind,
        agent,
        selectable: agent.routable && agent.sessionStatus !== 'archived',
        ...(agent.routabilityReasonCode
          ? { reasonCode: agent.routabilityReasonCode }
          : {}),
        duplicateIdentity,
        summary: targetSummary(agent, undefined, duplicateIdentity),
      };
    }

    const binding = bindings.find(
      (candidate) => candidate.bindingId === agent.bindingId,
    );
    const target: AgentRouteTarget = {
      type: 'managed_external',
      agentId: agent.agentId,
      bindingId: agent.bindingId ?? '',
      bindingRevision: binding?.revision ?? 0,
    };
    const bindingMatches =
      binding !== undefined &&
      binding.purpose === 'crew_agent' &&
      binding.status === 'active' &&
      binding.agentId === agent.agentId &&
      binding.sessionId === agent.sessionId;
    const reasonCode = !agent.routable
      ? (agent.routabilityReasonCode ?? 'agent_not_routable')
      : binding === undefined
        ? 'external_binding_missing'
        : !bindingMatches
          ? 'external_binding_stale'
          : undefined;
    return {
      key: targetKey(target),
      target,
      runtimeKind: agent.runtimeKind,
      agent,
      ...(binding === undefined ? {} : { binding }),
      selectable: reasonCode === undefined,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      duplicateIdentity,
      summary: targetSummary(agent, binding, duplicateIdentity),
    };
  });
}

export function validateSwitchboardDraft(
  draft: SwitchboardRouteDraft,
  targets: readonly SwitchboardTargetOption[],
): SwitchboardDraftValidation {
  const errors: string[] = [];
  const routeKey = draft.routeKey.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(routeKey)) {
    errors.push(
      "Route key must start alphanumeric and use only letters, numbers, '.', '_' or '-'.",
    );
  }
  const label = draft.label.trim();
  if (label.length === 0 || label.length > 256) {
    errors.push('Label is required and must be at most 256 characters.');
  }
  if (draft.description.length > 4_096) {
    errors.push('Description must be at most 4096 characters.');
  }
  const target = targets.find((candidate) => candidate.key === draft.targetKey);
  if (target === undefined) {
    errors.push('Select one exact target from the current service directory.');
  } else if (!target.selectable) {
    errors.push(
      `Selected target is not routable (${target.reasonCode ?? 'unknown_reason'}).`,
    );
  }
  if (
    target?.runtimeKind === 'direct_brain' &&
    draft.requiredDeliveryPolicy !== null
  ) {
    errors.push(
      'Direct Crew targets cannot require an external delivery policy.',
    );
  }
  if (
    target?.binding !== undefined &&
    draft.requiredDeliveryPolicy !== null &&
    target.binding.messageDeliveryPolicy !== draft.requiredDeliveryPolicy
  ) {
    errors.push(
      `Selected binding uses ${target.binding.messageDeliveryPolicy}, not ${draft.requiredDeliveryPolicy}.`,
    );
  }
  if (errors.length > 0 || target === undefined) {
    return {
      valid: false,
      errors,
      ...(target === undefined ? {} : { target }),
    };
  }
  const request: CoordinationRouteWriteRequest = {
    routeKey,
    label,
    enabled: draft.enabled,
    target: target.target,
    requiredRuntimeKind: target.runtimeKind,
    ...(draft.description.trim().length === 0
      ? {}
      : { description: draft.description.trim() }),
    ...(draft.requiredDeliveryPolicy === null
      ? {}
      : { requiredDeliveryPolicy: draft.requiredDeliveryPolicy }),
    ...(draft.expectedRevision === undefined
      ? {}
      : { expectedRevision: draft.expectedRevision }),
  };
  return { valid: true, errors, target, request };
}

export function projectSwitchboardRouteRows(
  resolutions: readonly AgentRouteResolution[],
  targetOptions: readonly SwitchboardTargetOption[] = [],
): readonly SwitchboardRouteRow[] {
  return resolutions.flatMap((resolution) => {
    const route = resolution.route;
    if (route === undefined || route === null) return [];
    const target = resolution.resolvedTarget;
    const routeTarget = route.target;
    const frozenTarget = targetOptions.find(
      (candidate) => candidate.key === targetKey(routeTarget),
    );
    const agentId = target?.agentId ?? routeTarget.agentId;
    const sessionId =
      target?.sessionId ??
      frozenTarget?.agent.sessionId ??
      (routeTarget.type === 'direct_brain' ? routeTarget.sessionId : '-');
    const bindingId =
      target?.bindingId ??
      (routeTarget.type === 'managed_external'
        ? routeTarget.bindingId
        : undefined);
    const bindingRevision =
      target?.bindingRevision ??
      (routeTarget.type === 'managed_external'
        ? routeTarget.bindingRevision
        : undefined);
    return [
      {
        address: resolution.address,
        routeKey: route.routeKey,
        label: route.label,
        enabled: route.enabled,
        routable: resolution.routable,
        ...(resolution.reasonCode ? { reasonCode: resolution.reasonCode } : {}),
        runtimeKind:
          target?.runtimeKind ??
          frozenTarget?.runtimeKind ??
          route.requiredRuntimeKind ??
          (routeTarget.type === 'managed_external'
            ? 'codex_app_server'
            : 'direct_brain'),
        profileId: target?.profileId ?? frozenTarget?.agent.profileId ?? '-',
        displayLabel:
          target?.displayLabel ??
          frozenTarget?.agent.displayLabel ??
          'unresolved target',
        agentId,
        sessionId,
        ...(bindingId === undefined ? {} : { bindingId }),
        ...(bindingRevision === undefined ? {} : { bindingRevision }),
        ...(target?.deliveryPolicy !== undefined &&
        target.deliveryPolicy !== null
          ? { deliveryPolicy: target.deliveryPolicy }
          : frozenTarget?.binding !== undefined
            ? { deliveryPolicy: frozenTarget.binding.messageDeliveryPolicy }
            : route.requiredDeliveryPolicy
              ? { deliveryPolicy: route.requiredDeliveryPolicy }
              : {}),
        revision: route.revision,
        ...(resolution.lastDelivery === undefined ||
        resolution.lastDelivery === null
          ? {}
          : {
              lastOutcome: normalizeSwitchboardOutcome(
                resolution.lastDelivery.status,
              ),
              ...(resolution.lastDelivery.reasonCode
                ? { lastReasonCode: resolution.lastDelivery.reasonCode }
                : {}),
            }),
        resolution,
      },
    ];
  });
}

export function deliveryOutcome(
  receipt: AgentMessageDeliveryReceipt,
): SwitchboardOutcomeKind {
  if (
    receipt.status === 'accepted' &&
    receipt.activation?.type === 'queued_for_next_turn'
  ) {
    return 'queued';
  }
  return normalizeSwitchboardOutcome(receipt.status);
}

export function normalizeSwitchboardOutcome(
  status: string,
  terminalReason?: string | null,
): SwitchboardOutcomeKind {
  if (terminalReason?.includes('no_reply') === true || status === 'no_reply') {
    return 'no_reply';
  }
  switch (status) {
    case 'pending':
    case 'accepted':
    case 'queued':
    case 'replied':
    case 'expired':
    case 'rejected':
    case 'failed':
      return status;
    case 'cancelled':
      return 'failed';
    default:
      return 'failed';
  }
}

export function targetKey(target: AgentRouteTarget): string {
  return target.type === 'direct_brain'
    ? `direct:${target.agentId}:${target.sessionId}`
    : `managed:${target.agentId}:${target.bindingId}:${target.bindingRevision}`;
}

function targetSummary(
  agent: AgentDirectoryEntry,
  binding: ExternalAgentBinding | undefined,
  duplicateIdentity: boolean,
): string {
  const prefix = duplicateIdentity ? 'duplicate profile · ' : '';
  return `${prefix}${agent.displayLabel} · ${agent.runtimeKind} · agent ${agent.agentId} · session ${agent.sessionId}${binding === undefined ? '' : ` · binding ${binding.bindingId} r${binding.revision}`}`;
}
