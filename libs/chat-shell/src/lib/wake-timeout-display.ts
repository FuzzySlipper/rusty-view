import type { ChatSessionSummary } from '@rusty-view/protocol';
import type {
  RuntimeConfigDraft,
  RuntimeConfigValidationReport,
  RuntimeWakeTimeoutConfig,
  RuntimeSessionDiagnostics,
} from '@rusty-view/transport';

export type WakeTimeoutPolicyDisplay =
  | {
      readonly mode: 'disabled';
      readonly source: 'explicit' | 'omitted' | 'unavailable';
    }
  | {
      readonly mode: 'default';
      readonly defaultMs: number;
      readonly source: 'explicit';
    };

interface WakeTimeoutConfig {
  readonly mode?: unknown;
  readonly defaultMs?: unknown;
}

export function serviceWakeTimeoutPolicy(
  config: RuntimeConfigValidationReport | null,
): WakeTimeoutPolicyDisplay {
  if (config === null) return { mode: 'disabled', source: 'unavailable' };
  const wakeTimeout = findWakeTimeoutConfig(config);
  if (wakeTimeout === undefined) return { mode: 'disabled', source: 'omitted' };
  const mode = wakeTimeout.mode;
  if (mode === 'default' && isPositiveNumber(wakeTimeout.defaultMs)) {
    return {
      mode: 'default',
      defaultMs: wakeTimeout.defaultMs,
      source: 'explicit',
    };
  }
  return { mode: 'disabled', source: 'explicit' };
}

export function serviceWakeTimeoutSummary(
  policy: WakeTimeoutPolicyDisplay,
): string {
  if (policy.mode === 'default') {
    return `default ${formatDurationMs(policy.defaultMs)}`;
  }
  return 'disabled / no service turn cap';
}

export function serviceWakeTimeoutSource(
  policy: WakeTimeoutPolicyDisplay,
): string {
  if (policy.source === 'explicit') return 'service config';
  if (policy.source === 'omitted') return 'wakeTimeout omitted';
  return 'config readback unavailable';
}

export function runtimeConfigDraftWithWakeTimeout(
  config: RuntimeConfigValidationReport | null,
  wakeTimeout: RuntimeWakeTimeoutConfig,
): RuntimeConfigDraft | undefined {
  const base = runtimeConfigDraftBase(config);
  if (base === undefined) return undefined;
  return { ...base, wakeTimeout };
}

export function runtimeConfigDraftBase(
  config: RuntimeConfigValidationReport | null,
): RuntimeConfigDraft | undefined {
  if (config === null) return undefined;
  return cloneRuntimeConfigDraft(config.runtimeConfig ?? config.serviceConfig);
}

export function effectiveWakeTimeoutMs(
  session: ChatSessionSummary,
  runtimeSession?: RuntimeSessionDiagnostics,
): number | undefined {
  return (
    readPositiveNumber(session.effective_defaults, 'wakeTimeoutMs') ??
    readPositiveNumber(runtimeSession?.effectiveDefaults, 'wakeTimeoutMs')
  );
}

export function effectiveWakeTimeoutLabel(
  session: ChatSessionSummary,
  runtimeSession?: RuntimeSessionDiagnostics,
): string {
  const timeoutMs = effectiveWakeTimeoutMs(session, runtimeSession);
  return timeoutMs === undefined
    ? 'disabled / no service turn cap'
    : formatDurationMs(timeoutMs);
}

export function profileWakeTimeoutLabel(
  sessions: readonly ChatSessionSummary[],
  runtimeSessionFor: (
    sessionId: string,
  ) => RuntimeSessionDiagnostics | undefined,
): string {
  const values = sessions
    .map((session) =>
      effectiveWakeTimeoutMs(session, runtimeSessionFor(session.session_id)),
    )
    .filter((value): value is number => value !== undefined);

  if (values.length === 0) return 'turn cap disabled / no service cap';
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length === 1)
    return `turn cap ${formatDurationMs(unique[0] ?? 0)}`;
  return `turn caps vary ${formatDurationMs(unique[0] ?? 0)}-${formatDurationMs(
    unique[unique.length - 1] ?? 0,
  )}`;
}

export function formatDurationMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded >= 60_000 && rounded % 60_000 === 0) {
    return `${rounded / 60_000} min (${rounded.toLocaleString()} ms)`;
  }
  if (rounded >= 1_000 && rounded % 1_000 === 0) {
    return `${rounded / 1_000} sec (${rounded.toLocaleString()} ms)`;
  }
  return `${rounded.toLocaleString()} ms`;
}

function findWakeTimeoutConfig(
  config: RuntimeConfigValidationReport,
): WakeTimeoutConfig | undefined {
  const record = config as unknown as Record<string, unknown>;
  const direct = readWakeTimeoutConfig(record['wakeTimeout']);
  if (direct !== undefined) return direct;
  const runtimeConfig = readRecord(record['runtimeConfig']);
  const runtime = readWakeTimeoutConfig(runtimeConfig?.['wakeTimeout']);
  if (runtime !== undefined) return runtime;
  const serviceConfig = readRecord(record['serviceConfig']);
  return readWakeTimeoutConfig(serviceConfig?.['wakeTimeout']);
}

function cloneRuntimeConfigDraft(
  value: RuntimeConfigDraft | undefined,
): RuntimeConfigDraft | undefined {
  if (value === undefined || !hasRequiredDraftArrays(value)) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as RuntimeConfigDraft;
}

function hasRequiredDraftArrays(value: RuntimeConfigDraft): boolean {
  return (
    Array.isArray(value.brains) &&
    Array.isArray(value.sessions) &&
    Array.isArray(value.scheduledJobs) &&
    Array.isArray(value.channelBindings) &&
    Array.isArray(value.mcpBindings)
  );
}

function readWakeTimeoutConfig(value: unknown): WakeTimeoutConfig | undefined {
  const record = readRecord(value);
  if (record === undefined) return undefined;
  return {
    mode: record['mode'],
    defaultMs: record['defaultMs'],
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readPositiveNumber(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (record === undefined) return undefined;
  const value = record[key];
  return isPositiveNumber(value) ? value : undefined;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
