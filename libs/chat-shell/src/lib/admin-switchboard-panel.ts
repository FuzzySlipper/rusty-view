import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {
  AgentRouteRecord,
  ExternalMessageDeliveryPolicy,
} from '@rusty-view/protocol';
import {
  SwitchboardStore,
  targetKey,
  validateSwitchboardDraft,
  type SwitchboardRouteDraft,
  type SwitchboardRouteRow,
} from '@rusty-view/chat-store';
import type { CoordinationRouteWriteRequest } from '@rusty-view/transport';

const EMPTY_DRAFT: SwitchboardRouteDraft = {
  routeKey: '',
  label: '',
  description: '',
  enabled: true,
  targetKey: '',
  requiredDeliveryPolicy: null,
};

@Component({
  selector: 'rv-admin-switchboard-panel',
  templateUrl: './admin-switchboard-panel.html',
  styleUrl: './admin-switchboard-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSwitchboardPanelComponent {
  protected readonly switchboard = inject(SwitchboardStore);
  protected readonly draft = signal<SwitchboardRouteDraft>(EMPTY_DRAFT);
  protected readonly editingRouteKey = signal<string | null>(null);
  protected readonly testBody = signal(
    'Reply with a short switchboard test acknowledgement.',
  );
  protected readonly testTtlSeconds = signal(30);
  protected readonly localNotice = signal<string | null>(null);
  protected readonly validation = computed(() =>
    validateSwitchboardDraft(this.draft(), this.switchboard.targetOptions()),
  );
  protected readonly selectedTarget = computed(() => this.validation().target);

  constructor() {
    void this.switchboard.refresh();
  }

  protected refresh(): void {
    this.localNotice.set(null);
    void this.switchboard.refresh();
  }

  protected newRoute(): void {
    this.editingRouteKey.set(null);
    this.draft.set(EMPTY_DRAFT);
    this.localNotice.set(null);
  }

  protected editRoute(row: SwitchboardRouteRow): void {
    const route = row.resolution.route;
    if (route === undefined || route === null) return;
    this.editingRouteKey.set(route.routeKey);
    this.draft.set({
      routeKey: route.routeKey,
      label: route.label,
      description: route.description ?? '',
      enabled: route.enabled,
      targetKey: targetKey(route.target),
      requiredDeliveryPolicy: route.requiredDeliveryPolicy ?? null,
      expectedRevision: route.revision,
    });
    this.localNotice.set(null);
  }

  protected setText(
    field: 'routeKey' | 'label' | 'description',
    event: Event,
  ): void {
    const value = inputValue(event);
    if (value === null) return;
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected setEnabled(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.draft.update((draft) => ({ ...draft, enabled: input.checked }));
  }

  protected setTarget(event: Event): void {
    const value = inputValue(event);
    if (value === null) return;
    const selected = this.switchboard
      .targetOptions()
      .find((target) => target.key === value);
    this.draft.update((draft) => ({
      ...draft,
      targetKey: value,
      requiredDeliveryPolicy:
        selected?.runtimeKind === 'direct_brain'
          ? null
          : (selected?.binding?.messageDeliveryPolicy ??
            draft.requiredDeliveryPolicy),
    }));
  }

  protected setPolicy(event: Event): void {
    const value = inputValue(event);
    if (value === null) return;
    this.draft.update((draft) => ({
      ...draft,
      requiredDeliveryPolicy:
        value === '' ? null : (value as ExternalMessageDeliveryPolicy),
    }));
  }

  protected setTestBody(event: Event): void {
    const value = inputValue(event);
    if (value !== null) this.testBody.set(value);
  }

  protected setTestTtl(event: Event): void {
    const value = inputValue(event);
    if (value !== null) this.testTtlSeconds.set(Number(value));
  }

  protected saveDisabled(): boolean {
    return this.switchboard.saving() || !this.validation().valid;
  }

  protected save(): void {
    const validation = this.validation();
    if (!validation.valid || validation.request === undefined) return;
    const editing = this.editingRouteKey();
    const operation =
      editing === null
        ? this.switchboard.createRoute(validation.request)
        : this.switchboard.updateRoute(editing, validation.request);
    void operation.then((saved) => {
      if (saved) this.editRouteByKey(validation.request?.routeKey ?? '');
    });
  }

  protected toggleRoute(row: SwitchboardRouteRow): void {
    const route = row.resolution.route;
    if (route === undefined || route === null) return;
    void this.switchboard
      .updateRoute(route.routeKey, routeWriteFromRecord(route, !route.enabled))
      .then((saved) => {
        if (saved && this.editingRouteKey() === route.routeKey) {
          this.editRouteByKey(route.routeKey);
        }
      });
  }

  protected deleteRoute(row: SwitchboardRouteRow): void {
    const route = row.resolution.route;
    if (route === undefined || route === null) return;
    if (
      !globalThis.confirm(`Delete ${row.address} revision ${route.revision}?`)
    ) {
      return;
    }
    void this.switchboard.deleteRoute(route).then((deleted) => {
      if (deleted && this.editingRouteKey() === route.routeKey) this.newRoute();
    });
  }

  protected resolveRoute(row: SwitchboardRouteRow): void {
    void this.switchboard.resolveAddress(row.address);
  }

  protected testDelivery(row: SwitchboardRouteRow): void {
    const request = this.testRequest();
    if (request === null) return;
    void this.switchboard.testDelivery(row.routeKey, request);
  }

  protected testRound(row: SwitchboardRouteRow): void {
    const request = this.testRequest();
    if (request === null) return;
    void this.switchboard.testRound(row.routeKey, request.body, request.ttlMs);
  }

  protected copyAddress(address: string): void {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard === undefined) {
      this.localNotice.set(`Could not copy ${address}.`);
      return;
    }
    void clipboard.writeText(address).then(
      () => this.localNotice.set(`Copied ${address}.`),
      () => this.localNotice.set(`Could not copy ${address}.`),
    );
  }

  protected rowTitle(row: SwitchboardRouteRow): string {
    return [
      `${row.address} revision ${row.revision}`,
      `agent ${row.agentId}`,
      `session ${row.sessionId}`,
      row.bindingId === undefined
        ? 'direct Crew target'
        : `binding ${row.bindingId} revision ${row.bindingRevision ?? '-'}`,
      row.reasonCode ?? (row.routable ? 'routable' : 'not routable'),
    ].join('\n');
  }

  private editRouteByKey(routeKey: string): void {
    const row = this.switchboard
      .rows()
      .find((candidate) => candidate.routeKey === routeKey);
    if (row !== undefined) this.editRoute(row);
  }

  private testRequest(): { body: string; ttlMs: number } | null {
    const body = this.testBody().trim();
    const ttlSeconds = this.testTtlSeconds();
    if (
      body.length === 0 ||
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > 300
    ) {
      this.localNotice.set(
        'Test body is required and TTL must be from 1 through 300 seconds.',
      );
      return null;
    }
    return { body, ttlMs: ttlSeconds * 1_000 };
  }
}

function routeWriteFromRecord(
  route: AgentRouteRecord,
  enabled: boolean,
): CoordinationRouteWriteRequest {
  return {
    routeKey: route.routeKey,
    label: route.label,
    enabled,
    target: route.target,
    expectedRevision: route.revision,
    ...(route.description === undefined || route.description === null
      ? {}
      : { description: route.description }),
    ...(route.requiredRuntimeKind === undefined ||
    route.requiredRuntimeKind === null
      ? {}
      : { requiredRuntimeKind: route.requiredRuntimeKind }),
    ...(route.requiredDeliveryPolicy === undefined ||
    route.requiredDeliveryPolicy === null
      ? {}
      : { requiredDeliveryPolicy: route.requiredDeliveryPolicy }),
  };
}

function inputValue(event: Event): string | null {
  const input = event.target;
  return input instanceof HTMLInputElement ||
    input instanceof HTMLTextAreaElement ||
    input instanceof HTMLSelectElement
    ? input.value
    : null;
}
