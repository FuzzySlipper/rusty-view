import {
  expect,
  test as base,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export { expect };

export interface LiveTurnOptions {
  readonly prompt: string;
  readonly assistantStartedTimeoutMs?: number;
  readonly assistantCompletedTimeoutMs?: number;
  readonly minStreamingMs?: number;
}

export interface VisualImpactOptions {
  readonly region?: Locator;
  readonly settleMs?: number;
  readonly minChangedBytes?: number;
}

interface ConsoleEntry {
  readonly type: string;
  readonly text: string;
  readonly location: string;
}

interface PageErrorEntry {
  readonly message: string;
  readonly stack?: string;
}

interface RustyViewDebugSnapshot {
  readonly activeSessionId: string | null;
  readonly connectionStatus: string;
  readonly isGenerating: boolean;
  readonly isStreaming: boolean;
  readonly lastCursor: string | null;
  readonly messageCount: number;
  readonly rawEventCount: number;
  readonly messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly status: string;
    readonly blockKinds: readonly string[];
    readonly text: string;
  }[];
}

interface RustyViewTestApi {
  getActiveSessionId(): string | null;
  getConnectionStatus(): string;
  getIsGenerating(): boolean;
  getIsStreaming(): boolean;
  getLastCursor(): string | null;
  getMessageCount(): number;
  getRawEventCount(): number;
  getMessages(): RustyViewDebugSnapshot['messages'];
}

type BrowserWindowWithRustyView = Window &
  typeof globalThis & {
    __RUSTY_VIEW_TEST__?: RustyViewTestApi;
  };

export const test = base.extend<{ live: LiveConversation }>({
  live: async ({ page }, use, testInfo) => {
    const live = new LiveConversation(page, testInfo);
    await live.start();
    try {
      await use(live);
    } finally {
      await live.finish();
    }
  },
});

export class LiveConversation {
  readonly backendUrl = env('RV_LIVE_BACKEND_URL') ?? 'http://127.0.0.1:9347';
  readonly targetProfile = env('RV_LIVE_PROFILE');

  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly pageErrors: PageErrorEntry[] = [];
  private readonly summaryLines: string[] = [];
  private traceStarted = false;

  constructor(
    readonly page: Page,
    private readonly testInfo: TestInfo,
  ) {}

  get artifactDir(): string {
    return this.testInfo.outputPath('live-artifacts');
  }

  async start(): Promise<void> {
    await mkdir(this.artifactDir, { recursive: true });
    this.page.on('console', (message) => {
      const location = message.location();
      this.consoleEntries.push({
        type: message.type(),
        text: message.text(),
        location: `${location.url}:${location.lineNumber}:${location.columnNumber}`,
      });
    });
    this.page.on('pageerror', (error) => {
      const entry: PageErrorEntry = {
        message: error.message,
      };
      if (error.stack !== undefined) {
        this.pageErrors.push({ ...entry, stack: error.stack });
      } else {
        this.pageErrors.push(entry);
      }
    });

    try {
      await this.page.context().tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
      this.traceStarted = true;
    } catch (error) {
      this.note(`Trace start skipped: ${errorMessage(error)}`);
    }
  }

  async finish(): Promise<void> {
    await this.writeJson('console.json', this.consoleEntries);
    await this.writeJson('page-errors.json', this.pageErrors);
    await this.writeText(
      'visible-transcript.txt',
      await this.visibleTranscriptText(),
    );
    await this.writeJson('debug-snapshot.json', await this.debugSnapshot());
    await this.writeText('scenario-summary.md', this.summaryMarkdown());

    if (this.traceStarted) {
      try {
        await this.page
          .context()
          .tracing.stop({ path: this.artifactPath('trace.zip') });
      } catch (error) {
        this.note(`Trace stop failed: ${errorMessage(error)}`);
      }
    }

    this.note(`Live artifacts: ${this.artifactDir}`);
  }

  async requireLiveRun(): Promise<void> {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      env('RV_LIVE_RUN') !== '1',
      'live Rusty View scenarios are opt-in; set RV_LIVE_RUN=1',
    );

    const reachable = await this.isBackendReachable();
    expect(
      reachable,
      `real Rusty Crew backend must be reachable at ${this.backendUrl}`,
    ).toBe(true);
  }

  async openAppAndSelectProfile(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.getByTestId('debug-shell')).toBeVisible({
      timeout: 10_000,
    });
    await this.screenshot('00-app-loaded');

    const profiles = this.page.getByTestId('profile-row');
    await expect(profiles.first()).toBeVisible({ timeout: 10_000 });
    const count = await profiles.count();
    if (count === 0) {
      throw new Error('No Rusty Crew profiles rendered in the real UI.');
    }

    const target = await this.resolveTargetProfile(profiles, count);
    await target.click();
    await expect(target).toHaveClass(/rv-profile--selected/);
    await expect(this.page.getByTestId('transcript-viewport')).toBeVisible({
      timeout: 10_000,
    });
    await this.screenshot('01-profile-selected');
  }

  async runTurn(options: LiveTurnOptions): Promise<Locator> {
    const beforeAssistantCount = await this.assistantMessages().count();
    await this.sendPrompt(options.prompt);
    await this.screenshot(this.nextArtifactName('prompt-sent'));

    const assistant = await this.waitForNextAssistant(
      beforeAssistantCount,
      options.assistantStartedTimeoutMs ?? 120_000,
    );

    if (options.minStreamingMs !== undefined && options.minStreamingMs > 0) {
      await this.waitForMinimumStreaming(assistant, options.minStreamingMs);
      await this.screenshot(this.nextArtifactName('streaming-in-progress'));
    }

    await this.waitForAssistantCompleted(
      assistant,
      options.assistantCompletedTimeoutMs ?? 180_000,
    );
    await expect(assistant).toBeVisible();
    await expect(assistant).not.toHaveText('');
    await this.screenshot(this.nextArtifactName('assistant-complete'));
    return assistant;
  }

  async sendPrompt(prompt: string): Promise<void> {
    const input = this.page.getByTestId('message-input-field');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(prompt);
    await this.page.getByTestId('send-message').click();
  }

  async waitForNextAssistant(
    previousCount: number,
    timeoutMs: number,
  ): Promise<Locator> {
    await expect
      .poll(async () => this.assistantMessages().count(), {
        timeout: timeoutMs,
      })
      .toBeGreaterThan(previousCount);

    const assistant = this.assistantMessages().nth(previousCount);
    await expect(assistant).toBeVisible({ timeout: 10_000 });
    return assistant;
  }

  async waitForMinimumStreaming(
    assistant: Locator,
    durationMs: number,
  ): Promise<void> {
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
      await expect(assistant).toHaveAttribute(
        'data-message-status',
        'streaming',
        { timeout: 1_000 },
      );
      // Intentional observation window: the scenario must remain visibly
      // streaming for the requested duration.
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await this.page.waitForTimeout(Math.min(500, deadline - Date.now()));
    }
  }

  async waitForAssistantCompleted(
    assistant: Locator,
    timeoutMs: number,
  ): Promise<void> {
    await expect(assistant).toHaveAttribute(
      'data-message-status',
      'completed',
      {
        timeout: timeoutMs,
      },
    );
  }

  async expectVisibleImpact(
    name: string,
    action: () => Promise<void>,
    options: VisualImpactOptions = {},
  ): Promise<void> {
    const region = options.region ?? this.page.getByTestId('transcript-shell');
    const beforeName = `${name}-before`;
    const afterName = `${name}-after`;
    const before = await this.screenshot(beforeName, region);
    await action();
    // Allow Angular rendering/layout to settle before comparing screenshots.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await this.page.waitForTimeout(options.settleMs ?? 300);
    const after = await this.screenshot(afterName, region);

    const changedBytes = countChangedBytes(before, after);
    const minimum = options.minChangedBytes ?? 250;
    this.note(
      `Visual impact ${name}: ${changedBytes} changed screenshot bytes; artifacts ${beforeName}.png and ${afterName}.png`,
    );
    expect(
      changedBytes,
      `${name} should visibly change the rendered UI; inspect ${this.artifactPath(
        beforeName + '.png',
      )} and ${this.artifactPath(afterName + '.png')}`,
    ).toBeGreaterThanOrEqual(minimum);
  }

  async screenshot(name: string, locator?: Locator): Promise<Buffer> {
    const path = this.artifactPath(`${sanitizeFileName(name)}.png`);
    await mkdir(dirname(path), { recursive: true });
    const buffer =
      locator === undefined
        ? await this.page.screenshot({ path, fullPage: true })
        : await locator.screenshot({ path });
    this.note(`Screenshot: ${path}`);
    return buffer;
  }

  async visibleTranscriptText(): Promise<string> {
    const transcript = this.page.getByTestId('transcript-shell');
    if ((await transcript.count()) === 0) {
      return '';
    }
    return transcript.innerText().catch(() => '');
  }

  async debugSnapshot(): Promise<RustyViewDebugSnapshot | null> {
    return this.page.evaluate(() => {
      const api = (window as BrowserWindowWithRustyView).__RUSTY_VIEW_TEST__;
      if (api === undefined) {
        return null;
      }
      return {
        activeSessionId: api.getActiveSessionId(),
        connectionStatus: api.getConnectionStatus(),
        isGenerating: api.getIsGenerating(),
        isStreaming: api.getIsStreaming(),
        lastCursor: api.getLastCursor(),
        messageCount: api.getMessageCount(),
        rawEventCount: api.getRawEventCount(),
        messages: api.getMessages(),
      };
    });
  }

  latestAssistantMessage(): Locator {
    return this.assistantMessages().last();
  }

  assistantMessages(): Locator {
    return this.page
      .getByTestId('message-row')
      .and(this.page.locator('[data-message-role="assistant"]'));
  }

  userMessages(): Locator {
    return this.page
      .getByTestId('message-row')
      .and(this.page.locator('[data-message-role="user"]'));
  }

  note(message: string): void {
    this.summaryLines.push(message);
    console.log(message);
  }

  artifactPath(fileName: string): string {
    return join(this.artifactDir, sanitizeFileName(fileName));
  }

  private async isBackendReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.backendUrl}/v1/chat/sessions`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async resolveTargetProfile(
    profiles: Locator,
    count: number,
  ): Promise<Locator> {
    if (this.targetProfile !== undefined && this.targetProfile.trim() !== '') {
      for (let i = 0; i < count; i++) {
        const candidate = profiles.nth(i);
        const id = await candidate.getAttribute('data-profile-id');
        const text = (await candidate.innerText()).trim();
        if (id === this.targetProfile || text.includes(this.targetProfile)) {
          this.note(`Selected requested live profile: ${this.targetProfile}`);
          return candidate;
        }
      }
      throw new Error(
        `Requested RV_LIVE_PROFILE=${this.targetProfile} was not rendered in the profile list.`,
      );
    }

    for (let i = 0; i < count; i++) {
      const candidate = profiles.nth(i);
      const status = await candidate.getAttribute('data-profile-status');
      if (status !== 'archived') {
        this.note(
          `Selected first non-archived live profile: ${
            (await candidate.getAttribute('data-profile-id')) ?? '<unknown>'
          }`,
        );
        return candidate;
      }
    }

    this.note(
      'Selected first rendered profile; every profile appeared archived.',
    );
    return profiles.first();
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    await writeFile(
      this.artifactPath(name),
      JSON.stringify(value, null, 2) + '\n',
      'utf8',
    );
  }

  private async writeText(name: string, value: string): Promise<void> {
    await writeFile(this.artifactPath(name), value, 'utf8');
  }

  private nextArtifactName(label: string): string {
    return `${String(this.summaryLines.length).padStart(2, '0')}-${label}`;
  }

  private summaryMarkdown(): string {
    return [
      '# Rusty View Live Scenario Summary',
      '',
      `- Backend: ${this.backendUrl}`,
      `- Requested profile: ${this.targetProfile ?? '<first non-archived>'}`,
      `- Console entries: ${this.consoleEntries.length}`,
      `- Page errors: ${this.pageErrors.length}`,
      '',
      '## Evidence Log',
      '',
      ...this.summaryLines.map((line) => `- ${line}`),
      '',
    ].join('\n');
  }
}

function env(name: string): string | undefined {
  return process.env[name];
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function countChangedBytes(left: Buffer, right: Buffer): number {
  const max = Math.max(left.length, right.length);
  let changed = 0;
  for (let i = 0; i < max; i++) {
    if (left[i] !== right[i]) {
      changed++;
    }
  }
  return changed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
