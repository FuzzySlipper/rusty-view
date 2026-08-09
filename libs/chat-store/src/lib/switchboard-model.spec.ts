import { describe, expect, it } from 'vitest';
import type {
  AgentDirectoryEntry,
  AgentMessageDeliveryReceipt,
  AgentRouteResolution,
  ExternalAgentBinding,
} from '@rusty-view/protocol';
import {
  buildSwitchboardTargetOptions,
  deliveryOutcome,
  normalizeSwitchboardOutcome,
  projectSwitchboardRouteRows,
  validateSwitchboardDraft,
} from './switchboard-model';

describe('switchboard model', () => {
  it('disambiguates duplicate profile/display identities with concrete IDs', () => {
    const agents = [
      directAgent('reviewer-a', 'session-a'),
      directAgent('reviewer-b', 'session-b'),
    ];

    const options = buildSwitchboardTargetOptions(agents, []);

    expect(options).toHaveLength(2);
    expect(options.every((option) => option.duplicateIdentity)).toBe(true);
    expect(options[0]?.summary).toContain('agent reviewer-a');
    expect(options[0]?.summary).toContain('session session-a');
    expect(options[1]?.summary).toContain('agent reviewer-b');
    expect(options[1]?.summary).toContain('session session-b');
  });

  it('rejects stale targets and policy mismatches without substituting by profile', () => {
    const agent = managedAgent();
    const binding = managedBinding('immediate_steer');
    const options = buildSwitchboardTargetOptions([agent], [binding]);
    const option = options[0];
    if (option === undefined) throw new Error('target option missing');

    const mismatch = validateSwitchboardDraft(
      {
        routeKey: 'reviewer',
        label: 'Reviewer',
        description: '',
        enabled: true,
        targetKey: option.key,
        requiredDeliveryPolicy: 'serial_next_turn',
      },
      options,
    );
    expect(mismatch.valid).toBe(false);
    expect(mismatch.errors.join(' ')).toContain('immediate_steer');

    const staleOptions = buildSwitchboardTargetOptions([agent], []);
    const stale = staleOptions[0];
    if (stale === undefined) throw new Error('stale target missing');
    const result = validateSwitchboardDraft(
      {
        routeKey: 'reviewer',
        label: 'Reviewer',
        description: '',
        enabled: true,
        targetKey: stale.key,
        requiredDeliveryPolicy: null,
      },
      staleOptions,
    );
    expect(stale.selectable).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('external_binding_missing');
  });

  it('builds an exact revision-checked managed route write', () => {
    const options = buildSwitchboardTargetOptions(
      [managedAgent()],
      [managedBinding('serial_next_turn')],
    );
    const option = options[0];
    if (option === undefined) throw new Error('target option missing');

    const result = validateSwitchboardDraft(
      {
        routeKey: 'reviewer',
        label: 'Serial reviewer',
        description: 'One exact binding',
        enabled: true,
        targetKey: option.key,
        requiredDeliveryPolicy: 'serial_next_turn',
        expectedRevision: 7,
      },
      options,
    );

    expect(result.valid).toBe(true);
    expect(result.request).toEqual({
      routeKey: 'reviewer',
      label: 'Serial reviewer',
      description: 'One exact binding',
      enabled: true,
      target: {
        type: 'managed_external',
        agentId: 'reviewer-agent',
        bindingId: 'binding-1',
        bindingRevision: 4,
      },
      requiredRuntimeKind: 'codex_app_server',
      requiredDeliveryPolicy: 'serial_next_turn',
      expectedRevision: 7,
    });
  });

  it('projects unresolved routes without hiding their frozen concrete IDs', () => {
    const rows = projectSwitchboardRouteRows([
      routeResolution({ routable: false, reasonCode: 'binding_replaced' }),
    ]);

    expect(rows[0]).toMatchObject({
      address: '@reviewer',
      agentId: 'reviewer-agent',
      bindingId: 'binding-1',
      bindingRevision: 4,
      routable: false,
      reasonCode: 'binding_replaced',
      revision: 7,
    });
  });

  it('joins a disabled managed route only to the same exact binding revision', () => {
    const options = buildSwitchboardTargetOptions(
      [managedAgent()],
      [managedBinding('serial_next_turn')],
    );
    const rows = projectSwitchboardRouteRows(
      [
        routeResolution({
          routable: false,
          reasonCode: 'agent_route_disabled',
        }),
      ],
      options,
    );

    expect(rows[0]).toMatchObject({
      profileId: 'reviewer-profile',
      displayLabel: 'Reviewer',
      sessionId: 'reviewer-session',
      bindingId: 'binding-1',
      bindingRevision: 4,
      deliveryPolicy: 'serial_next_turn',
    });
  });

  it('normalizes every operator delivery and round outcome', () => {
    expect(normalizeSwitchboardOutcome('accepted')).toBe('accepted');
    expect(normalizeSwitchboardOutcome('queued')).toBe('queued');
    expect(normalizeSwitchboardOutcome('replied')).toBe('replied');
    expect(normalizeSwitchboardOutcome('no_reply')).toBe('no_reply');
    expect(normalizeSwitchboardOutcome('expired')).toBe('expired');
    expect(normalizeSwitchboardOutcome('rejected')).toBe('rejected');
    expect(normalizeSwitchboardOutcome('failed')).toBe('failed');
    expect(normalizeSwitchboardOutcome('cancelled')).toBe('failed');
    expect(
      normalizeSwitchboardOutcome('expired', 'agent_message_no_reply'),
    ).toBe('no_reply');
    expect(deliveryOutcome(delivery('queued_for_next_turn'))).toBe('queued');
  });
});

function directAgent(agentId: string, sessionId: string): AgentDirectoryEntry {
  return {
    agentId,
    sessionId,
    profileId: 'reviewer-profile',
    displayLabel: 'Reviewer',
    sessionKind: 'full',
    sessionStatus: 'idle',
    runtimeKind: 'direct_brain',
    routable: true,
  };
}

function managedAgent(): AgentDirectoryEntry {
  return {
    ...directAgent('reviewer-agent', 'reviewer-session'),
    runtimeKind: 'codex_app_server',
    runtimeId: 'codex-runtime',
    bindingId: 'binding-1',
    bindingStatus: 'active',
  };
}

function managedBinding(
  policy: 'immediate_steer' | 'serial_next_turn',
): ExternalAgentBinding {
  return {
    bindingId: 'binding-1',
    runtimeId: 'codex-runtime',
    nativeThreadId: 'thread-1',
    sessionId: 'reviewer-session',
    agentId: 'reviewer-agent',
    profileId: 'reviewer-profile',
    profileRevision: 1,
    profilePromptHash: 'hash',
    profilePromptSnapshot: null,
    purpose: 'crew_agent',
    status: 'active',
    messageDeliveryPolicy: policy,
    dynamicToolCatalogFingerprint: null,
    effectiveConfigFingerprint: 'fingerprint',
    lineage: null,
    revision: 4,
    createdAt: '2026-07-21T00:00:00Z',
    updatedAt: '2026-07-21T00:00:00Z',
  };
}

function routeResolution(
  override: Partial<AgentRouteResolution> = {},
): AgentRouteResolution {
  return {
    address: '@reviewer',
    routable: true,
    route: {
      routeKey: 'reviewer',
      label: 'Reviewer',
      enabled: true,
      target: {
        type: 'managed_external',
        agentId: 'reviewer-agent',
        bindingId: 'binding-1',
        bindingRevision: 4,
      },
      requiredRuntimeKind: 'codex_app_server',
      requiredDeliveryPolicy: 'serial_next_turn',
      revision: 7,
      createdAt: '2026-07-21T00:00:00Z',
      updatedAt: '2026-07-21T00:00:00Z',
    },
    ...override,
  };
}

function delivery(
  activationType: 'queued_for_next_turn',
): AgentMessageDeliveryReceipt {
  return {
    request: {
      deliveryId: 'delivery-1',
      idempotencyKey: 'delivery-1',
      messageId: 'message-1',
      fromAgentId: 'operator',
      requestedAddress: '@reviewer',
      toAgentId: 'reviewer-agent',
      toSessionId: 'reviewer-session',
      inputKind: 'routed_agent_message',
      body: 'test',
      requireWake: true,
      createdAt: '2026-07-21T00:00:00Z',
      expiresAt: '2026-07-21T00:00:30Z',
    },
    status: 'accepted',
    activation: {
      type: activationType,
      sessionId: 'reviewer-session',
      queueId: 'queue-1',
    },
    revision: 1,
  };
}
