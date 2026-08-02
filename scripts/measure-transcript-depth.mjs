#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  projectConversation,
  projectExternalAgentTranscript,
} = require('../dist/libs/chat-domain/src/index.js');

const sources = parseSources(process.argv.slice(2));
if (sources.length === 0) {
  throw new Error(
    'Usage: node scripts/measure-transcript-depth.mjs --source label=http://host:port [--source ...]',
  );
}

const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  privacy: {
    emitsSessionIds: false,
    emitsTranscriptContent: false,
    method:
      'Fetch projections in memory; emit only counts, percentiles, complexity flags, and typed error totals.',
  },
  sources: [],
};

for (const source of sources) {
  report.sources.push(await measureSource(source));
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function parseSources(args) {
  const parsed = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--source') continue;
    const value = args[index + 1];
    if (value === undefined) throw new Error('--source requires label=url');
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error('--source requires label=url');
    parsed.push({
      label: value.slice(0, separator),
      baseUrl: value.slice(separator + 1).replace(/\/$/, ''),
    });
    index += 1;
  }
  return parsed;
}

async function measureSource(source) {
  const errors = [];
  const native = await measureNativeSessions(source, errors);
  const external = await measureExternalThreads(source, errors);
  return {
    label: source.label,
    native,
    external,
    errors: summarizeErrors(errors),
  };
}

async function measureNativeSessions(source, errors) {
  let summaries;
  try {
    const response = await requestJson(
      `${source.baseUrl}/v1/chat/sessions?limit=1000`,
    );
    summaries = response.data?.items ?? [];
  } catch (error) {
    errors.push({ surface: 'native_list', error });
    return unavailableDistribution();
  }

  const measurements = await mapConcurrent(summaries, 4, async (summary) => {
    try {
      const response = await requestJson(
        `${source.baseUrl}/v1/chat/sessions/${encodeURIComponent(summary.session_id)}`,
      );
      const messages = projectConversation(
        response.data?.events ?? [],
      ).messages;
      return projectionMeasurement(messages, summary.status === 'archived');
    } catch (error) {
      errors.push({ surface: 'native_read', error });
      return undefined;
    }
  });
  return aggregateMeasurements(measurements.filter(Boolean));
}

async function measureExternalThreads(source, errors) {
  let runtimes;
  try {
    const response = await requestJson(
      `${source.baseUrl}/v1/external-runtimes`,
    );
    runtimes = response.data?.runtimes ?? [];
  } catch (error) {
    errors.push({ surface: 'external_runtime_list', error });
    return unavailableDistribution();
  }

  const measurements = [];
  for (const runtime of runtimes) {
    for (const archived of [false, true]) {
      let threads;
      try {
        threads = await listAllThreads(
          source.baseUrl,
          runtime.runtimeId,
          archived,
        );
      } catch (error) {
        errors.push({ surface: 'external_thread_list', error });
        continue;
      }
      const runtimeMeasurements = await mapConcurrent(
        threads,
        3,
        async (thread) => {
          try {
            const response = await requestJson(
              `${source.baseUrl}/v1/external-runtimes/${encodeURIComponent(runtime.runtimeId)}/threads/read`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  threadId: thread.threadId,
                  includeTurns: true,
                }),
              },
            );
            const fullThread = response.data?.thread;
            const messages = projectExternalAgentTranscript(fullThread, []);
            return projectionMeasurement(messages, archived);
          } catch (error) {
            errors.push({ surface: 'external_thread_read', error });
            return undefined;
          }
        },
      );
      measurements.push(...runtimeMeasurements.filter(Boolean));
    }
  }
  return aggregateMeasurements(measurements);
}

async function listAllThreads(baseUrl, runtimeId, archived) {
  const items = [];
  let cursor;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ limit: '100' });
    if (archived) query.set('archived', 'true');
    if (cursor !== undefined) query.set('cursor', cursor);
    const response = await requestJson(
      `${baseUrl}/v1/external-runtimes/${encodeURIComponent(runtimeId)}/threads?${query}`,
    );
    const pageItems = response.data?.items ?? [];
    items.push(...pageItems);
    const next = response.data?.nextCursor;
    if (
      typeof next !== 'string' ||
      next.length === 0 ||
      pageItems.length === 0
    ) {
      break;
    }
    cursor = next;
  }
  return items;
}

function projectionMeasurement(messages, archived) {
  const blockKinds = new Map();
  const complexity = {
    reasoning: false,
    code: false,
    table: false,
    toolDetail: false,
    image: false,
    revisionActions: false,
    roleplayDecoration: false,
  };
  let blockCount = 0;
  let characterCount = 0;
  for (const message of messages) {
    if (message.metadata?.['roleplay'] !== undefined) {
      complexity.roleplayDecoration = true;
    }
    if (
      message.metadata?.['alternateSlotId'] !== undefined ||
      message.tree !== undefined
    ) {
      complexity.revisionActions = true;
    }
    for (const block of message.blocks) {
      blockCount += 1;
      blockKinds.set(block.kind, (blockKinds.get(block.kind) ?? 0) + 1);
      const content = typeof block.content === 'string' ? block.content : '';
      characterCount += content.length;
      if (block.kind === 'reasoning') complexity.reasoning = true;
      if (block.kind === 'tool_call' || block.kind === 'command') {
        complexity.toolDetail = true;
      }
      if (block.kind === 'attachment' && block.attachment?.kind === 'image') {
        complexity.image = true;
      }
      if (/```|<pre\b|<code\b/.test(content)) complexity.code = true;
      if (
        /^\s*\|.+\|\s*$/m.test(content) &&
        /^\s*\|?\s*:?-{3,}/m.test(content)
      ) {
        complexity.table = true;
      }
    }
  }
  return {
    archived,
    messageCount: messages.length,
    blockCount,
    characterCount,
    blockKinds: Object.fromEntries(blockKinds),
    complexity,
  };
}

function aggregateMeasurements(measurements) {
  if (measurements.length === 0) return unavailableDistribution();
  const live = measurements.filter((measurement) => !measurement.archived);
  const archived = measurements.filter((measurement) => measurement.archived);
  return {
    available: true,
    sampleCount: measurements.length,
    liveSampleCount: live.length,
    archivedSampleCount: archived.length,
    projectedMessages: distribution(
      measurements.map((item) => item.messageCount),
    ),
    liveProjectedMessages: distribution(live.map((item) => item.messageCount)),
    blocksPerSession: distribution(measurements.map((item) => item.blockCount)),
    charactersPerSession: distribution(
      measurements.map((item) => item.characterCount),
    ),
    complexitySessionCounts: Object.fromEntries(
      Object.keys(measurements[0].complexity).map((key) => [
        key,
        measurements.filter((measurement) => measurement.complexity[key])
          .length,
      ]),
    ),
    blockKindTotals: sumObjects(measurements.map((item) => item.blockKinds)),
  };
}

function unavailableDistribution() {
  return {
    available: false,
    sampleCount: 0,
    liveSampleCount: 0,
    archivedSampleCount: 0,
  };
}

function distribution(values) {
  if (values.length === 0)
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1),
  };
}

function percentile(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function sumObjects(objects) {
  const totals = {};
  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

function summarizeErrors(errors) {
  const bySurface = {};
  for (const entry of errors) {
    bySurface[entry.surface] = (bySurface[entry.surface] ?? 0) + 1;
  }
  return { count: errors.length, bySurface };
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  }
  const payload = await response.json();
  if (payload?.ok !== true) {
    throw new Error(`Envelope failure for ${new URL(url).pathname}`);
  }
  return payload;
}
