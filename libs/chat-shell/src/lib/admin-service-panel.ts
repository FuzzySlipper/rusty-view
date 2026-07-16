import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  inject,
  output,
} from '@angular/core';
import type {
  RuntimeConfigDiagnostic,
  RuntimeWakeTimeoutConfig,
} from '@rusty-view/transport';
import { AdminStore } from '@rusty-view/chat-store';
import { CHAT_DEBUG_TAB_CONTEXT } from './shell-extension-tokens';

import {
  formatDurationMs,
  runtimeConfigDraftBase,
  runtimeConfigDraftWithWakeTimeout,
  serviceWakeTimeoutPolicy,
  serviceWakeTimeoutSource,
  serviceWakeTimeoutSummary,
} from './wake-timeout-display';

type CapabilityStatus = 'available' | 'partial' | 'checking' | 'missing';

interface ServiceCapabilityRow {
  readonly label: string;
  readonly capabilityIds?: readonly string[];
  readonly staticStatus?: 'explicit';
}

const CONFIG_RELOAD_CAPABILITY_ID = 'admin.control.config.reload';
const CONFIG_WAKE_TIMEOUT_PATCH_CAPABILITY_ID =
  'admin.control.config.wake_timeout.patch';
const CONFIG_DRAFT_CAPABILITY_IDS = [
  'admin.control.config.draft.plan',
  'admin.control.config.draft.apply',
] as const;

const APPLY_SEMANTICS_ROWS: readonly ServiceCapabilityRow[] = [
  {
    label: 'service reload',
    capabilityIds: [CONFIG_RELOAD_CAPABILITY_ID],
  },
  {
    label: 'session creation',
    staticStatus: 'explicit',
  },
  {
    label: 'channel joins',
    staticStatus: 'explicit',
  },
  {
    label: 'config save',
    capabilityIds: [
      'admin.control.config.draft.plan',
      'admin.control.config.draft.apply',
    ],
  },
  {
    label: 'wake timeout save',
    capabilityIds: [CONFIG_WAKE_TIMEOUT_PATCH_CAPABILITY_ID],
  },
  {
    label: 'brain hot swap',
    capabilityIds: [
      'admin.control.profiles.rebuild_brain.plan',
      'admin.control.profiles.rebuild_brain.apply',
    ],
  },
  {
    label: 'session runtime rebuild',
    capabilityIds: [
      'admin.control.sessions.rebuild_runtime.plan',
      'admin.control.sessions.rebuild_runtime.apply',
    ],
  },
];

@Component({
  selector: 'rv-admin-service-panel',
  templateUrl: './admin-service-panel.html',
  styleUrl: './admin-service-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminServicePanelComponent {
  protected readonly admin = inject(AdminStore);
  protected readonly embedded =
    inject(CHAT_DEBUG_TAB_CONTEXT, { optional: true })?.embedded === true;
  protected readonly applySemanticsRows = APPLY_SEMANTICS_ROWS;
  protected readonly reloadCapabilityStatus = computed(() =>
    this.capabilityStatusFor([CONFIG_RELOAD_CAPABILITY_ID]),
  );
  protected readonly wakeTimeoutPatchCapabilityStatus = computed(() =>
    this.capabilityStatusFor([CONFIG_WAKE_TIMEOUT_PATCH_CAPABILITY_ID]),
  );
  protected readonly draftSaveCapabilityStatus = computed(() =>
    this.capabilityStatusFor(CONFIG_DRAFT_CAPABILITY_IDS),
  );
  protected readonly savePath = computed<'patch' | 'draft' | null>(() => {
    if (this.wakeTimeoutPatchCapabilityStatus() === 'available') {
      return 'patch';
    }
    if (
      this.draftSaveCapabilityStatus() === 'available' &&
      this.hasRuntimeConfigDraftBase()
    ) {
      return 'draft';
    }
    return null;
  });
  protected readonly wakeTimeoutPolicy = computed(() =>
    serviceWakeTimeoutPolicy(this.admin.configValidation()),
  );
  protected readonly draftMode = signal<'disabled' | 'default'>('disabled');
  protected readonly draftDefaultMs = signal(600_000);
  protected readonly localError = signal<string | null>(null);
  protected readonly hasRuntimeConfigDraftBase = computed(
    () => runtimeConfigDraftBase(this.admin.configValidation()) !== undefined,
  );
  protected readonly draftWakeTimeout =
    computed<RuntimeWakeTimeoutConfig | null>(() => {
      if (this.draftMode() === 'disabled') return { mode: 'disabled' };
      const defaultMs = this.draftDefaultMs();
      return Number.isInteger(defaultMs) && defaultMs > 0
        ? { mode: 'default', defaultMs }
        : null;
    });
  protected readonly draftSummary = computed(() => {
    const draft = this.draftWakeTimeout();
    if (draft === null) return 'Enter a positive timeout.';
    return draft.mode === 'disabled'
      ? 'disabled / no service turn cap'
      : `default ${formatDurationMs(draft.defaultMs)}`;
  });

  readonly dismissed = output<void>();

  constructor() {
    void this.admin.refresh().then(() => this.resetDraftFromPolicy());
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }

  protected refresh(): void {
    void this.admin.refresh().then(() => this.resetDraftFromPolicy());
  }

  protected reloadDisabled(): boolean {
    return this.admin.saving() || this.reloadCapabilityStatus() !== 'available';
  }

  protected reloadTitle(): string {
    const status = this.reloadCapabilityStatus();
    if (status === 'available') return 'Reload service config';
    if (status === 'checking') return 'Checking config reload capability';
    return `Config reload capability ${status}`;
  }

  protected reload(): void {
    if (this.reloadDisabled()) return;
    void this.admin.reloadConfig();
  }

  protected setDraftMode(mode: 'disabled' | 'default'): void {
    this.localError.set(null);
    this.draftMode.set(mode);
  }

  protected setDraftDefaultMs(event: Event): void {
    this.localError.set(null);
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.draftDefaultMs.set(Number(input.value));
  }

  protected saveDisabled(): boolean {
    return (
      this.admin.saving() ||
      this.savePath() === null ||
      this.draftWakeTimeout() === null
    );
  }

  protected saveTitle(): string {
    if (this.wakeTimeoutPatchCapabilityStatus() === 'available') {
      if (this.draftWakeTimeout() === null) {
        return 'Enter a positive default timeout in milliseconds';
      }
      return 'Save wake timeout policy';
    }
    const draftCapability = this.draftSaveCapabilityStatus();
    if (draftCapability !== 'available') {
      return `Wake timeout patch capability ${this.wakeTimeoutPatchCapabilityStatus()}; config draft capability ${draftCapability}`;
    }
    if (!this.hasRuntimeConfigDraftBase()) {
      return 'Safe wake timeout patch or full runtime config draft readback is required before saving';
    }
    if (this.draftWakeTimeout() === null) {
      return 'Enter a positive default timeout in milliseconds';
    }
    return 'Save wake timeout policy';
  }

  protected saveWakeTimeout(): void {
    if (this.saveDisabled()) return;
    const wakeTimeout = this.draftWakeTimeout();
    if (wakeTimeout === null) return;
    if (this.savePath() === 'patch') {
      void this.admin
        .patchWakeTimeoutConfig({
          wakeTimeout,
          reason: 'rusty-view wake timeout policy update',
        })
        .then((saved) => {
          if (saved) this.resetDraftFromPolicy();
        });
      return;
    }
    const runtimeConfig = runtimeConfigDraftWithWakeTimeout(
      this.admin.configValidation(),
      wakeTimeout,
    );
    if (runtimeConfig === undefined) {
      this.localError.set(
        'Full runtime config draft readback is required before saving.',
      );
      return;
    }
    void this.admin
      .applyRuntimeConfigDraft({
        runtimeConfig,
        reason: 'rusty-view wake timeout policy update',
      })
      .then((saved) => {
        if (saved) this.resetDraftFromPolicy();
      });
  }

  protected wakeTimeoutSummary(): string {
    return serviceWakeTimeoutSummary(this.wakeTimeoutPolicy());
  }

  protected wakeTimeoutSource(): string {
    return serviceWakeTimeoutSource(this.wakeTimeoutPolicy());
  }

  protected wakeTimeoutEditingStatus(): string {
    if (this.wakeTimeoutPatchCapabilityStatus() === 'available') {
      return 'editable via wake-timeout patch';
    }
    if (this.draftSaveCapabilityStatus() !== 'available') {
      return `wake timeout patch capability ${this.wakeTimeoutPatchCapabilityStatus()}; config draft capability ${this.draftSaveCapabilityStatus()}`;
    }
    if (!this.hasRuntimeConfigDraftBase()) {
      return 'full config draft readback needed';
    }
    return 'editable via config draft';
  }

  protected patchWakeTimeoutSummary(): string {
    const result = this.admin.wakeTimeoutPatchResult()?.outcome.result;
    if (result === undefined) return '';
    return serviceWakeTimeoutSummary({
      ...result.wakeTimeout,
      source: 'explicit',
    });
  }

  protected diagnosticCount(
    diagnostics: readonly RuntimeConfigDiagnostic[],
    severity: RuntimeConfigDiagnostic['severity'],
  ): number {
    return diagnostics.filter((diagnostic) => diagnostic.severity === severity)
      .length;
  }

  private resetDraftFromPolicy(): void {
    const policy = this.wakeTimeoutPolicy();
    this.draftMode.set(policy.mode);
    this.draftDefaultMs.set(
      policy.mode === 'default' ? policy.defaultMs : 600_000,
    );
    this.localError.set(null);
  }

  protected capabilityStatus(
    row: ServiceCapabilityRow,
  ): CapabilityStatus | 'explicit' {
    if (row.staticStatus !== undefined) return row.staticStatus;
    return this.capabilityStatusFor(row.capabilityIds ?? []);
  }

  private capabilityStatusFor(
    capabilityIds: readonly string[],
  ): CapabilityStatus {
    const states = capabilityIds.map((id) =>
      this.admin.controlCapabilityState(id),
    );
    if (states.length === 0) return 'missing';
    if (states.every((state) => state === 'available')) return 'available';
    if (states.some((state) => state === 'unknown')) return 'checking';
    if (states.some((state) => state === 'available')) return 'partial';
    return 'missing';
  }
}
