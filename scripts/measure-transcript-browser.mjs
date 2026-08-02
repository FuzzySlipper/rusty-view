#!/usr/bin/env node

import { chromium } from '@playwright/test';

const baseUrl = process.env['BASE_URL'] ?? 'http://127.0.0.1:9348';
const depths = (process.env['RV_TRANSCRIPT_DEPTHS'] ?? '250,1000,5000,10000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const repeats = Number(process.env['RV_TRANSCRIPT_REPEATS'] ?? '3');
if (!Number.isInteger(repeats) || repeats < 1) {
  throw new Error('RV_TRANSCRIPT_REPEATS must be a positive integer');
}

const browser = await chromium.launch({
  args: ['--enable-precise-memory-info'],
});
const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  renderer: 'owned-window',
  browser: {
    engine: 'chromium',
    version: browser.version(),
  },
  privacy: {
    realTranscriptContentUsed: false,
    method:
      'Deterministic synthetic projections; output contains aggregate browser measurements only.',
  },
  repeats,
  depths: [],
};

try {
  for (const depth of depths) {
    const runs = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      process.stderr.write(
        `measure transcript renderer=owned-window depth=${depth} run=${repeat + 1}/${repeats}\n`,
      );
      try {
        runs.push(await measureDepth(browser, depth));
      } catch (error) {
        runs.push({
          error: {
            name: error instanceof Error ? error.name : 'UnknownError',
            message:
              error instanceof Error
                ? error.message.split('\n')[0]
                : String(error),
          },
        });
        await Promise.all(browser.contexts().map((context) => context.close()));
      }
    }
    const successfulRuns = runs.filter((run) => run.error === undefined);
    report.depths.push({
      projectedMessages: depth,
      successfulRuns: successfulRuns.length,
      failedRuns: runs.length - successfulRuns.length,
      median:
        successfulRuns.length === 0 ? null : aggregateRuns(successfulRuns),
      runs,
    });
  }
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function measureDepth(browserInstance, depth) {
  const context = await browserInstance.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__RV_SCALE_LONG_TASKS__ = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__RV_SCALE_LONG_TASKS__.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // Long Task API is not implemented by every browser engine.
    }
  });
  await installFixture(page, depth);

  const loadStarted = performance.now();
  const applicationUrl = new URL(baseUrl);
  await page.goto(applicationUrl.href);
  const primarySessionId = `scale-${depth}`;
  await page
    .locator(
      `[data-testid="profile-session-row"][data-session-id="${primarySessionId}"]`,
    )
    .click();
  const viewport = page.getByTestId('transcript-viewport');
  await viewport.waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .locator(
      `[data-testid="transcript-item"][data-message-id="${primarySessionId}:message:${depth}"]`,
    )
    .waitFor({ state: 'attached', timeout: 60_000 });
  await settleFrames(page, 4);
  const initialLoadMs = performance.now() - loadStarted;
  const loadLongTasks = await drainLongTasks(page);

  const residency = await page.evaluate(() => {
    const transcript = document.querySelector(
      '[data-testid="transcript-viewport"]',
    );
    const rendered = Array.from(
      transcript?.querySelectorAll('[data-testid="transcript-item"]') ?? [],
    );
    const spacers = Array.from(
      transcript?.querySelectorAll('.rv-transcript__window-spacer') ?? [],
    );
    const memory = performance.memory;
    return {
      documentNodes: document.getElementsByTagName('*').length,
      transcriptNodes: transcript?.getElementsByTagName('*').length ?? 0,
      renderedMessages: rendered.length,
      firstRenderedMessageId:
        rendered.at(0)?.getAttribute('data-message-id') ?? null,
      lastRenderedMessageId:
        rendered.at(-1)?.getAttribute('data-message-id') ?? null,
      windowSpacerHeights: spacers.map(
        (spacer) => spacer.getBoundingClientRect().height,
      ),
      usedJsHeapBytes:
        typeof memory?.usedJSHeapSize === 'number'
          ? memory.usedJSHeapSize
          : null,
    };
  });

  await drainLongTasks(page);
  const inputFrameMs = await page
    .getByTestId('message-input-field')
    .evaluate(async (input) => {
      input.focus();
      const started = performance.now();
      input.value = 'synthetic responsiveness probe';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return performance.now() - started;
    });
  const inputLongTasks = await drainLongTasks(page);

  await page.getByRole('button', { name: 'Search' }).click();
  await drainLongTasks(page);
  const targetSequence = Math.max(1, Math.floor(depth / 2));
  const searchStarted = performance.now();
  await page
    .getByTestId('transcript-search-input')
    .fill(`unique-scale-target-${targetSequence}`);
  await page
    .locator(
      `[data-testid="transcript-item"][data-message-id="${primarySessionId}:message:${targetSequence}"]`,
    )
    .waitFor({ state: 'visible', timeout: 60_000 });
  const searchMs = performance.now() - searchStarted;
  const searchLongTasks = await drainLongTasks(page);
  await page.getByTestId('transcript-search-clear').click();

  await drainLongTasks(page);
  const coldHistory = await viewport.evaluate(async (element) => {
    element.scrollTop = Math.max(
      0,
      (element.scrollHeight - element.clientHeight) * 0.2,
    );
    element.dispatchEvent(new Event('scroll'));
    const frames = [];
    for (let frame = 1; frame <= 60; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const bounds = element.getBoundingClientRect();
      const firstFullyVisible = Array.from(
        element.querySelectorAll('[data-testid="transcript-item"]'),
      )
        .map((row) => ({
          id: row.dataset.messageId ?? '',
          bounds: row.getBoundingClientRect(),
        }))
        .find(
          (row) =>
            row.bounds.top >= bounds.top - 1 &&
            row.bounds.bottom <= bounds.bottom + 1,
        );
      frames.push({
        frame,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        thumbFraction:
          element.scrollHeight <= element.clientHeight
            ? 1
            : element.scrollTop / (element.scrollHeight - element.clientHeight),
        firstFullyVisibleId: firstFullyVisible?.id ?? null,
        firstFullyVisibleTop:
          firstFullyVisible === undefined
            ? null
            : firstFullyVisible.bounds.top - bounds.top,
      });
    }
    let maxExtentChange = 0;
    let maxOffsetChange = 0;
    let maxThumbFractionChange = 0;
    for (let index = 1; index < frames.length; index += 1) {
      maxExtentChange = Math.max(
        maxExtentChange,
        Math.abs(frames[index].scrollHeight - frames[index - 1].scrollHeight),
      );
      maxOffsetChange = Math.max(
        maxOffsetChange,
        Math.abs(frames[index].scrollTop - frames[index - 1].scrollTop),
      );
      maxThumbFractionChange = Math.max(
        maxThumbFractionChange,
        Math.abs(frames[index].thumbFraction - frames[index - 1].thumbFraction),
      );
    }
    const anchorId = frames.at(0)?.firstFullyVisibleId ?? null;
    const anchorTop = frames.at(0)?.firstFullyVisibleTop ?? null;
    const anchorFrames = frames.filter(
      (frame) => frame.firstFullyVisibleId === anchorId,
    );
    return {
      sampledFrames: frames.length,
      firstScrollHeight: frames.at(0)?.scrollHeight ?? null,
      finalScrollHeight: frames.at(-1)?.scrollHeight ?? null,
      maxPerFrameExtentChangePx: maxExtentChange,
      maxPerFrameOffsetChangePx: maxOffsetChange,
      maxPerFrameThumbFractionChange: maxThumbFractionChange,
      anchorIdStable:
        anchorId !== null && anchorFrames.length === frames.length,
      maxAnchorDriftPx:
        anchorTop === null || anchorFrames.length === 0
          ? null
          : Math.max(
              ...anchorFrames.map((frame) =>
                Math.abs(frame.firstFullyVisibleTop - anchorTop),
              ),
            ),
    };
  });
  const coldHistoryLongTasks = await drainLongTasks(page);

  await drainLongTasks(page);
  const replacementStarted = performance.now();
  await page
    .locator(
      '[data-testid="profile-session-row"][data-session-id="scale-replacement"]',
    )
    .click();
  await page
    .locator(
      '[data-testid="transcript-item"][data-message-id="scale-replacement:message:25"]',
    )
    .waitFor({ state: 'visible', timeout: 30_000 });
  const sessionSwitchMs = performance.now() - replacementStarted;
  const sessionSwitchLongTasks = await drainLongTasks(page);

  const longTasks = [
    ...loadLongTasks,
    ...inputLongTasks,
    ...searchLongTasks,
    ...coldHistoryLongTasks,
    ...sessionSwitchLongTasks,
  ];
  await context.close();
  return {
    projectedMessages: depth,
    initialLoadMs: round(initialLoadMs),
    sessionSwitchMs: round(sessionSwitchMs),
    searchMs: round(searchMs),
    inputNextFrameMs: round(inputFrameMs),
    residency,
    longTasks: {
      count: longTasks.length,
      totalDurationMs: round(
        longTasks.reduce((total, entry) => total + entry.duration, 0),
      ),
      maxDurationMs: round(
        Math.max(0, ...longTasks.map((entry) => entry.duration)),
      ),
    },
    longTasksByPhase: {
      load: summarizeLongTasks(loadLongTasks),
      input: summarizeLongTasks(inputLongTasks),
      search: summarizeLongTasks(searchLongTasks),
      coldHistory: summarizeLongTasks(coldHistoryLongTasks),
      sessionSwitch: summarizeLongTasks(sessionSwitchLongTasks),
    },
    coldHistory,
  };
}

async function installFixture(page, depth) {
  const primarySessionId = `scale-${depth}`;
  const primaryEvents = Array.from({ length: depth }, (_, index) =>
    messageEvent(primarySessionId, index + 1),
  );
  const replacementEvents = Array.from({ length: 25 }, (_, index) =>
    messageEvent('scale-replacement', index + 1),
  );
  const summaries = [
    summary(primarySessionId, `Synthetic scale ${depth}`, depth),
    summary('scale-replacement', 'Synthetic replacement', 25),
  ];

  await page.route('**/v1/chat/commands', (route) =>
    fulfillJson(route, { commands: [] }),
  );
  await page.route('**/v1/external-runtimes*', (route) =>
    fulfillJson(route, { runtimes: [] }),
  );
  await page.route('**/v1/coordination/agents', (route) =>
    fulfillJson(route, {
      deploymentRole: 'production',
      agents: summaries.map((item) => ({
        agentId: 'scale-agent',
        displayLabel: 'scale-agent',
        profileId: 'scale-profile',
        routable: true,
        runtimeKind: 'direct_brain',
        sessionId: item.session_id,
        sessionKind: 'full',
        sessionStatus: 'idle',
        workdir: '/tmp/scale-measurement',
      })),
    }),
  );
  await page.route('**/v1/chat/sessions*', (route) =>
    fulfillJson(route, { items: summaries, total: 2, limit: 100, offset: 0 }),
  );
  await page.route('**/v1/chat/sessions/*', (route) => {
    const replacement = route.request().url().includes('scale-replacement');
    return fulfillJson(route, {
      session: replacement ? summaries[1] : summaries[0],
      events: replacement ? replacementEvents : primaryEvents,
    });
  });
  await page.route('**/v1/chat/sessions/*/events*', (route) =>
    fulfillJson(route, { items: [], latest_cursor: null, has_more: false }),
  );
  await page.route('**/v1/chat/sessions/*/stream*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': synthetic scale measurement\n\n',
    }),
  );
}

function messageEvent(sessionId, sequence) {
  const target = `unique-scale-target-${sequence}`;
  const complex = sequence % 20 === 0;
  const body = complex
    ? `${target}\n\n| Depth | Stable |\n|---|---:|\n| ${sequence} | yes |\n\n\`\`\`typescript\nconst depth = ${sequence};\n\`\`\``
    : `${target} deterministic variable-height content `.repeat(
        sequence % 7 === 0 ? 8 : 2,
      );
  return {
    event_id: `${sessionId}:event:${sequence}`,
    session_id: sessionId,
    sequence_id: sequence,
    created_at: new Date(1_700_000_000_000 + sequence * 1000).toISOString(),
    kind: 'message_created',
    payload: {
      message_id: `${sessionId}:message:${sequence}`,
      role: sequence % 2 === 0 ? 'assistant' : 'user',
      body,
    },
  };
}

function summary(sessionId, title, count) {
  return {
    session_id: sessionId,
    agent_id: 'scale-agent',
    profile_id: 'scale-profile',
    kind: 'full',
    status: 'idle',
    title,
    latest_cursor: `${sessionId}:cursor`,
    created_at: '2026-08-02T01:00:00Z',
    updated_at: '2026-08-02T01:05:00Z',
    message_count: count,
    tool_event_count: 0,
  };
}

function fulfillJson(route, data) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      data,
      meta: { request_id: 'req_scale_measurement', schema_version: 1 },
    }),
  });
}

async function settleFrames(page, count) {
  await page.evaluate(async (frameCount) => {
    for (let frame = 0; frame < frameCount; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, count);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function drainLongTasks(page) {
  return page.evaluate(() => {
    const tasks = window.__RV_SCALE_LONG_TASKS__ ?? [];
    window.__RV_SCALE_LONG_TASKS__ = [];
    return tasks;
  });
}

function summarizeLongTasks(tasks) {
  return {
    count: tasks.length,
    totalDurationMs: round(
      tasks.reduce((total, entry) => total + entry.duration, 0),
    ),
    maxDurationMs: round(Math.max(0, ...tasks.map((entry) => entry.duration))),
  };
}

function aggregateRuns(runs) {
  const medianAt = (read) => {
    const values = runs
      .map(read)
      .filter((value) => typeof value === 'number')
      .sort((left, right) => left - right);
    if (values.length === 0) return null;
    const middle = Math.floor(values.length / 2);
    return round(
      values.length % 2 === 1
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2,
    );
  };
  return {
    initialLoadMs: medianAt((run) => run.initialLoadMs),
    sessionSwitchMs: medianAt((run) => run.sessionSwitchMs),
    searchMs: medianAt((run) => run.searchMs),
    inputNextFrameMs: medianAt((run) => run.inputNextFrameMs),
    residency: {
      documentNodes: medianAt((run) => run.residency.documentNodes),
      transcriptNodes: medianAt((run) => run.residency.transcriptNodes),
      renderedMessages: medianAt((run) => run.residency.renderedMessages),
      usedJsHeapBytes: medianAt((run) => run.residency.usedJsHeapBytes),
    },
    longTasks: {
      count: medianAt((run) => run.longTasks.count),
      totalDurationMs: medianAt((run) => run.longTasks.totalDurationMs),
      maxDurationMs: medianAt((run) => run.longTasks.maxDurationMs),
    },
    longTasksByPhase: Object.fromEntries(
      ['load', 'input', 'search', 'coldHistory', 'sessionSwitch'].map(
        (phase) => [
          phase,
          {
            count: medianAt((run) => run.longTasksByPhase[phase].count),
            totalDurationMs: medianAt(
              (run) => run.longTasksByPhase[phase].totalDurationMs,
            ),
            maxDurationMs: medianAt(
              (run) => run.longTasksByPhase[phase].maxDurationMs,
            ),
          },
        ],
      ),
    ),
    coldHistory: {
      maxPerFrameExtentChangePx: medianAt(
        (run) => run.coldHistory.maxPerFrameExtentChangePx,
      ),
      maxPerFrameOffsetChangePx: medianAt(
        (run) => run.coldHistory.maxPerFrameOffsetChangePx,
      ),
      maxPerFrameThumbFractionChange: medianAt(
        (run) => run.coldHistory.maxPerFrameThumbFractionChange,
      ),
      maxPerFrameThumbBasisPoints: medianAt(
        (run) => run.coldHistory.maxPerFrameThumbFractionChange * 10_000,
      ),
      anchorStableRunCount: runs.filter((run) => run.coldHistory.anchorIdStable)
        .length,
      maxAnchorDriftPx: medianAt((run) => run.coldHistory.maxAnchorDriftPx),
    },
  };
}
