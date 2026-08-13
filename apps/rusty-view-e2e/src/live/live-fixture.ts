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
  readonly finalTextMustInclude?: readonly string[];
  readonly finalTextMinLength?: number;
  readonly allowProviderFailureText?: boolean;
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

interface ScreenshotArtifact {
  readonly name: string;
  readonly path: string;
  readonly fullPage: boolean;
  readonly capturedAtMs: number;
}

interface DebugSnapshotArtifact {
  readonly name: string;
  readonly path: string;
  readonly capturedAtMs: number;
  readonly snapshot: RustyViewDebugSnapshot | null;
}

interface TimelineEvent {
  readonly name: string;
  readonly atMs: number;
  readonly elapsedMs: number;
  readonly details?: Record<string, unknown>;
}

interface LiveTurnEvidence {
  readonly index: number;
  readonly promptPreview: string;
  readonly promptLength: number;
  beforeAssistantCount: number;
  beforeUserCount?: number;
  userSentAtMs?: number;
  userMessageId?: string;
  assistantStateAtMs?: number;
  assistantVisibleAtMs?: number;
  assistantContentVisibleAtMs?: number;
  assistantCompletedAtMs?: number;
  firstAssistantMessageId?: string;
  completedAssistantMessageId?: string;
  assistantMessageId?: string;
  rawEventCountAtStart?: number;
  rawEventCountAtComplete?: number;
  messageCountAtStart?: number;
  messageCountAtComplete?: number;
  finalStatus?: string;
  finalBlockKinds?: readonly string[];
  finalTextPreview?: string;
}

interface VisualImpactEvidence {
  readonly name: string;
  readonly beforePath: string;
  readonly afterPath: string;
  readonly changedBytes: number;
  readonly minChangedBytes: number;
  readonly beforeTextPreview: string;
  readonly afterTextPreview: string;
  readonly capturedAtMs: number;
}

interface LiveProfileIsolation {
  readonly enabled: boolean;
  readonly sourceProfile: string;
  readonly profilePrefix?: string;
  modelConfigId?: string;
  localToolProfileId?: string;
  createRequest?: LiveProfileCreateRequest;
  createdAtMs?: number;
  createdSessionId?: string;
  cleanupAttemptedAtMs?: number;
  archivedSessionIds?: string[];
  profileDeletedAtMs?: number;
  cleanupError?: string;
}

export interface IsolatedProfileIdInput {
  readonly prefix: string;
  readonly title: string;
  readonly workerIndex: number;
  readonly retry: number;
  readonly startedAtMs: number;
}

export interface LiveProfileIsolationPrefixInput {
  readonly liveRun?: string;
  readonly profilePrefix?: string;
  readonly profileIsolation?: string;
}

export interface LiveProfileCreateRequest {
  readonly profileId: string;
  readonly displayName: string;
  readonly modelConfigId: string;
  readonly kind: 'full';
  readonly localToolProfileId: string;
  readonly reason: string;
}

export const DEFAULT_LIVE_BACKEND_URL = 'http://127.0.0.1:9348';

export interface IsolatedLiveProfileCleanupInput {
  readonly backendUrl: string;
  readonly profileId: string;
  readonly reason: string;
  readonly idempotencyScope: string;
  readonly fetchImpl?: typeof fetch;
}

export async function cleanupIsolatedLiveProfile(
  input: IsolatedLiveProfileCleanupInput,
): Promise<string[]> {
  const request = input.fetchImpl ?? fetch;
  const listResponse = await request(
    `${input.backendUrl}/v1/chat/sessions?profile_id=${encodeURIComponent(input.profileId)}&limit=100`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const listText = await listResponse.text();
  if (!listResponse.ok) {
    throw new Error(
      `Failed to list isolated live sessions for ${input.profileId}: HTTP ${listResponse.status} ${listText}`,
    );
  }
  const sessions = adminControlPayload(parseJsonObject(listText));
  const items = Array.isArray(sessions['items']) ? sessions['items'] : [];
  const archivedSessionIds: string[] = [];
  for (const item of items) {
    if (!isRecord(item) || stringValue(item, 'status') === 'archived') {
      continue;
    }
    const sessionId = stringValue(item, 'session_id');
    if (sessionId === undefined) {
      continue;
    }
    const archiveResponse = await request(
      `${input.backendUrl}/v1/chat/sessions/${encodeURIComponent(sessionId)}/commands`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `rv-live-cleanup-${sessionId}-${input.idempotencyScope}`,
        },
        body: JSON.stringify({ command: '/archive' }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const archiveText = await archiveResponse.text();
    if (!archiveResponse.ok) {
      throw new Error(
        `Failed to archive isolated live session ${sessionId}: HTTP ${archiveResponse.status} ${archiveText}`,
      );
    }
    archivedSessionIds.push(sessionId);
  }

  const deleteResponse = await request(
    `${input.backendUrl}/v1/admin/control/profiles/${encodeURIComponent(input.profileId)}/delete`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: input.reason,
        confirmProfileId: input.profileId,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const deleteText = await deleteResponse.text();
  if (!deleteResponse.ok) {
    throw new Error(
      `Failed to delete isolated live profile ${input.profileId}: HTTP ${deleteResponse.status} ${deleteText}`,
    );
  }
  return archivedSessionIds;
}

export interface RustyViewDebugSnapshot {
  readonly backendBaseUrl: string;
  readonly activeSessionId: string | null;
  readonly connectionStatus: string;
  readonly isGenerating: boolean;
  readonly isStreaming: boolean;
  readonly streamingCharCount: number;
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
  getBackendBaseUrl(): string;
  getActiveSessionId(): string | null;
  getConnectionStatus(): string;
  getIsGenerating(): boolean;
  getIsStreaming(): boolean;
  getStreamingCharCount(): number;
  getLastCursor(): string | null;
  getMessageCount(): number;
  getRawEventCount(): number;
  getMessages(): RustyViewDebugSnapshot['messages'];
  scrollToMessageId(messageId: string): void;
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
  readonly backendUrl = env('RV_LIVE_BACKEND_URL') ?? DEFAULT_LIVE_BACKEND_URL;
  readonly appUrl = liveAppUrlForBackend(this.backendUrl);
  readonly sourceProfile = env('RV_LIVE_PROFILE') ?? 'tester';
  readonly targetProfile: string;

  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly pageErrors: PageErrorEntry[] = [];
  private readonly summaryLines: string[] = [];
  private readonly screenshots: ScreenshotArtifact[] = [];
  private readonly debugSnapshots: DebugSnapshotArtifact[] = [];
  private readonly timeline: TimelineEvent[] = [];
  private readonly turns: LiveTurnEvidence[] = [];
  private readonly visualChecks: VisualImpactEvidence[] = [];
  private readonly startedAt = Date.now();
  private readonly profileIsolation: LiveProfileIsolation;
  private renderedBackendUrl: string | null = null;
  private profilePrepared = false;
  private traceStarted = false;

  constructor(
    readonly page: Page,
    private readonly testInfo: TestInfo,
  ) {
    const profilePrefix = liveProfileIsolationPrefix({
      liveRun: env('RV_LIVE_RUN'),
      profilePrefix: env('RV_LIVE_PROFILE_PREFIX'),
      profileIsolation: env('RV_LIVE_PROFILE_ISOLATION'),
    });
    if (profilePrefix !== undefined && profilePrefix.length > 0) {
      const profileId = isolatedLiveProfileId({
        prefix: profilePrefix,
        title: testInfo.title,
        workerIndex: testInfo.workerIndex,
        retry: testInfo.retry,
        startedAtMs: this.startedAt,
      });
      this.targetProfile = profileId;
      this.profileIsolation = {
        enabled: true,
        sourceProfile: this.sourceProfile,
        profilePrefix,
        modelConfigId:
          env('RV_LIVE_MODEL_CONFIG_ID') ??
          env('RV_LIVE_PROFILE_MODEL_CONFIG_ID') ??
          env('RV_LIVE_PROVIDER_ALIAS'),
        localToolProfileId: env('RV_LIVE_LOCAL_TOOL_PROFILE_ID'),
      };
    } else {
      this.targetProfile = this.sourceProfile;
      this.profileIsolation = {
        enabled: false,
        sourceProfile: this.sourceProfile,
      };
    }
  }

  get artifactDir(): string {
    return this.testInfo.outputPath('live-artifacts');
  }

  async start(): Promise<void> {
    await mkdir(this.artifactDir, { recursive: true });
    this.recordTimeline('fixture:start', {
      backendUrl: this.backendUrl,
      appUrl: this.appUrl,
      targetProfile: this.targetProfile,
      baseUrl: env('BASE_URL') ?? '<playwright-default>',
    });
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
    this.recordTimeline('fixture:finish:start');
    const finishErrors: Error[] = [];
    let visibleTranscriptText = '';
    let finalDebugSnapshot: RustyViewDebugSnapshot | null = null;
    try {
      visibleTranscriptText = await this.visibleTranscriptText();
      finalDebugSnapshot = await this.captureDebugSnapshot('final');
    } catch (error) {
      const captureError = asError(error);
      finishErrors.push(captureError);
      this.note(`Final live evidence capture failed: ${captureError.message}`);
    }

    try {
      await this.cleanupIsolatedProfile();
    } catch (error) {
      const cleanupError = asError(error);
      finishErrors.push(cleanupError);
      this.profileIsolation.cleanupError = cleanupError.message;
      this.recordTimeline('profile:cleanup:failed', {
        profileId: this.targetProfile,
        error: cleanupError.message,
      });
      this.note(
        `Isolated live profile cleanup failed for ${this.targetProfile}: ${cleanupError.message}`,
      );
    }

    try {
      await this.writeJson('console.json', this.consoleEntries);
      await this.writeJson('page-errors.json', this.pageErrors);
      await this.writeText('visible-transcript.txt', visibleTranscriptText);
      await this.writeJson('debug-snapshot.json', finalDebugSnapshot);
      await this.writeText('scenario-summary.md', this.summaryMarkdown());
      await this.writeJson(
        'evidence-packet.json',
        this.evidencePacket(visibleTranscriptText, finalDebugSnapshot),
      );
    } catch (error) {
      finishErrors.push(asError(error));
    }

    if (this.traceStarted) {
      try {
        await this.page
          .context()
          .tracing.stop({ path: this.artifactPath('trace.zip') });
      } catch (error) {
        this.note(`Trace stop failed: ${errorMessage(error)}`);
      }
    }

    this.recordTimeline('fixture:finish:complete');
    this.note(`Live artifacts: ${this.artifactDir}`);
    if (finishErrors.length > 0) {
      throw new AggregateError(
        finishErrors,
        `Rusty View live fixture teardown failed with ${finishErrors.length} error(s).`,
      );
    }
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
    await this.ensureLiveProfileReady();
    await this.page.goto(this.appUrl);
    this.recordTimeline('app:navigated', {
      url: this.page.url(),
      appUrl: this.appUrl,
      intendedBackendUrl: canonicalBackendUrl(this.backendUrl),
    });
    await expect(this.page.getByTestId('debug-shell')).toBeVisible({
      timeout: 10_000,
    });
    await this.assertRenderedBackendMatchesFixture();
    await this.screenshot('00-app-loaded');
    await this.captureDebugSnapshot('00-app-loaded');

    const profiles = this.page.getByTestId('profile-row');
    await expect(profiles.first()).toBeVisible({ timeout: 10_000 });
    const count = await profiles.count();
    if (count === 0) {
      throw new Error('No Rusty Crew profiles rendered in the real UI.');
    }

    const target = await this.resolveTargetProfile(profiles, count);
    const defaultSessionId = await target.getAttribute(
      'data-default-session-id',
    );
    const targetSession = this.page.locator(
      `[data-testid="profile-session-row"][data-session-id="${defaultSessionId ?? ''}"]`,
    );
    if (
      defaultSessionId !== null &&
      (await targetSession.first().isVisible())
    ) {
      await targetSession.first().click();
      await expect(targetSession.first()).toHaveClass(
        /rv-profile-session--selected/,
        { timeout: 30_000 },
      );
    } else {
      await target.click();
    }
    await expect(target).toHaveClass(/rv-profile--selected/, {
      timeout: 10_000,
    });
    await expect(this.page.getByTestId('transcript-viewport')).toBeVisible({
      timeout: 10_000,
    });
    await this.screenshot('01-profile-selected');
    await this.captureDebugSnapshot('01-profile-selected');
    this.recordTimeline('profile:selected', {
      profile: this.targetProfile,
      url: this.page.url(),
    });
  }

  async runTurn(options: LiveTurnOptions): Promise<Locator> {
    const turn: LiveTurnEvidence = {
      index: this.turns.length + 1,
      promptPreview: previewText(options.prompt, 300),
      promptLength: options.prompt.length,
      beforeAssistantCount: (await this.assistantMessageStates()).length,
    };
    this.turns.push(turn);
    const beforeSnapshot = await this.captureDebugSnapshot(
      `turn-${turn.index}-before-send`,
    );
    if (beforeSnapshot !== null) {
      turn.rawEventCountAtStart = beforeSnapshot.rawEventCount;
      turn.messageCountAtStart = beforeSnapshot.messageCount;
    }
    const beforeAssistantCount = (await this.assistantMessageStates()).length;
    const beforeUserCount = (await this.userMessageStates()).length;
    turn.beforeAssistantCount = beforeAssistantCount;
    turn.beforeUserCount = beforeUserCount;

    await this.sendPrompt(options.prompt);
    turn.userSentAtMs = Date.now();
    this.recordTimeline('turn:user-sent', {
      turn: turn.index,
      promptLength: turn.promptLength,
      beforeAssistantCount,
      beforeUserCount,
    });
    await this.screenshot(this.nextArtifactName('prompt-sent'));
    await this.captureDebugSnapshot(`turn-${turn.index}-prompt-sent`);

    const sentUser = await this.waitForSentUserMessage(
      options.prompt,
      beforeUserCount,
      options.assistantStartedTimeoutMs ?? 120_000,
    );
    turn.userMessageId = sentUser.id;
    this.recordTimeline('turn:user-message-correlated', {
      turn: turn.index,
      messageId: sentUser.id,
    });

    let assistant = await this.waitForNextAssistantMessageAfterUser(
      sentUser.id,
      options.assistantStartedTimeoutMs ?? 120_000,
    );
    turn.assistantStateAtMs = Date.now();
    turn.assistantVisibleAtMs = Date.now();
    const assistantMessageId = await assistant.getAttribute('data-message-id');
    if (assistantMessageId !== null) {
      turn.firstAssistantMessageId = assistantMessageId;
      turn.assistantMessageId = assistantMessageId;
    }
    this.recordTimeline('turn:assistant-visible', {
      turn: turn.index,
      messageId: turn.assistantMessageId,
    });
    await this.captureDebugSnapshot(`turn-${turn.index}-assistant-visible`);
    assistant = await this.waitForVisibleAssistantContentAfterUser(
      sentUser.id,
      assistantMessageId ?? undefined,
      Math.min(options.assistantCompletedTimeoutMs ?? 180_000, 60_000),
    );
    const contentMessageId = await assistant.getAttribute('data-message-id');
    if (
      contentMessageId !== null &&
      turn.assistantMessageId !== contentMessageId
    ) {
      this.recordTimeline('turn:assistant-id-changed-before-content', {
        turn: turn.index,
        firstMessageId: turn.assistantMessageId,
        contentMessageId,
      });
      turn.assistantMessageId = contentMessageId;
    }
    turn.assistantContentVisibleAtMs = Date.now();
    this.recordTimeline('turn:assistant-content-visible', {
      turn: turn.index,
      messageId: turn.assistantMessageId,
    });
    await this.captureDebugSnapshot(`turn-${turn.index}-assistant-content`);

    if (options.minStreamingMs !== undefined && options.minStreamingMs > 0) {
      this.recordTimeline('turn:min-streaming-window:start', {
        turn: turn.index,
        minStreamingMs: options.minStreamingMs,
      });
      await this.waitForMinimumStreaming(assistant, options.minStreamingMs);
      this.recordTimeline('turn:min-streaming-window:complete', {
        turn: turn.index,
        minStreamingMs: options.minStreamingMs,
      });
      await this.screenshot(this.nextArtifactName('streaming-in-progress'));
      await this.captureDebugSnapshot(`turn-${turn.index}-streaming-window`);
    }

    const completedAssistant = await this.waitForAssistantCompletedAfterUser(
      sentUser.id,
      options.assistantCompletedTimeoutMs ?? 180_000,
    );
    turn.assistantCompletedAtMs = Date.now();
    const completedMessageId =
      await completedAssistant.getAttribute('data-message-id');
    if (completedMessageId !== null) {
      turn.completedAssistantMessageId = completedMessageId;
      turn.assistantMessageId = completedMessageId;
    }
    if (
      turn.firstAssistantMessageId !== undefined &&
      turn.completedAssistantMessageId !== undefined &&
      turn.firstAssistantMessageId !== turn.completedAssistantMessageId
    ) {
      this.recordTimeline('turn:assistant-id-changed-before-completion', {
        turn: turn.index,
        firstMessageId: turn.firstAssistantMessageId,
        completedMessageId: turn.completedAssistantMessageId,
      });
    }
    const completeSnapshot = await this.captureDebugSnapshot(
      `turn-${turn.index}-assistant-complete`,
    );
    if (completeSnapshot !== null) {
      turn.rawEventCountAtComplete = completeSnapshot.rawEventCount;
      turn.messageCountAtComplete = completeSnapshot.messageCount;
    }
    const finalState = completeSnapshot?.messages.find(
      (message) => message.id === turn.assistantMessageId,
    );
    if (finalState !== undefined) {
      turn.finalStatus = finalState.status;
      turn.finalBlockKinds = finalState.blockKinds;
    }
    turn.finalTextPreview = previewText(finalState?.text ?? '', 500);
    this.assertFinalAssistantText(finalState, options);
    this.recordTimeline('turn:assistant-complete', {
      turn: turn.index,
      messageId: turn.assistantMessageId,
      rawEventCount: turn.rawEventCountAtComplete,
      messageCount: turn.messageCountAtComplete,
      blockKinds: turn.finalBlockKinds,
    });
    await expect(completedAssistant).toBeVisible();
    await expect(completedAssistant).not.toHaveText('');
    await this.screenshot(this.nextArtifactName('assistant-complete'));
    return completedAssistant;
  }

  async sendPrompt(prompt: string): Promise<void> {
    const input = this.page.getByTestId('message-input-field');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(prompt);
    await this.page.getByTestId('send-message').click();
  }

  async waitForNextAssistantMessage(
    previousCount: number,
    timeoutMs: number,
  ): Promise<Locator> {
    await expect
      .poll(async () => (await this.assistantMessageStates()).length, {
        timeout: timeoutMs,
      })
      .toBeGreaterThan(previousCount);

    const assistantState = (await this.assistantMessageStates()).at(-1);
    if (assistantState === undefined) {
      throw new Error(
        'Assistant message state appeared but could not be read.',
      );
    }

    const assistant = this.messageById(assistantState.id);
    await this.ensureMessageRowVisible(assistantState.id, 10_000);
    return assistant;
  }

  async waitForSentUserMessage(
    prompt: string,
    previousCount: number,
    timeoutMs: number,
  ): Promise<RustyViewDebugSnapshot['messages'][number]> {
    await expect
      .poll(
        async () =>
          findSentUserMessage(
            await this.userMessageStates(),
            prompt,
            previousCount,
          ) !== undefined,
        { timeout: timeoutMs },
      )
      .toBe(true);

    const userState = findSentUserMessage(
      await this.userMessageStates(),
      prompt,
      previousCount,
    );
    if (userState === undefined) {
      throw new Error('Sent user message appeared but could not be read.');
    }
    return userState;
  }

  async waitForNextAssistantMessageAfterUser(
    userMessageId: string,
    timeoutMs: number,
  ): Promise<Locator> {
    await expect
      .poll(
        async () =>
          (await this.assistantMessageStatesAfterUser(userMessageId)).length,
        { timeout: timeoutMs },
      )
      .toBeGreaterThan(0);

    const assistantState = (
      await this.assistantMessageStatesAfterUser(userMessageId)
    ).at(0);
    if (assistantState === undefined) {
      throw new Error(
        'Assistant message after the sent user message appeared but could not be read.',
      );
    }

    return this.waitForCorrelatedAssistantRow(
      userMessageId,
      assistantState.id,
      10_000,
      () => true,
    );
  }

  async waitForVisibleAssistantContentAfterUser(
    userMessageId: string,
    preferredMessageId: string | undefined,
    timeoutMs: number,
  ): Promise<Locator> {
    return this.waitForCorrelatedAssistantRow(
      userMessageId,
      preferredMessageId,
      timeoutMs,
      (state) => state.text.trim().length > 0,
    );
  }

  private async waitForCorrelatedAssistantRow(
    userMessageId: string,
    preferredMessageId: string | undefined,
    timeoutMs: number,
    matches: (state: RustyViewDebugSnapshot['messages'][number]) => boolean,
  ): Promise<Locator> {
    const deadline = Date.now() + timeoutMs;
    let currentMessageId = preferredMessageId;
    while (Date.now() < deadline) {
      const states = await this.assistantMessageStatesAfterUser(userMessageId);
      const state =
        states.find((candidate) => candidate.id === currentMessageId) ??
        states.at(0);
      if (state !== undefined) {
        if (currentMessageId !== undefined && state.id !== currentMessageId) {
          this.recordTimeline('transcript:assistant-id-replaced', {
            userMessageId,
            previousMessageId: currentMessageId,
            replacementMessageId: state.id,
          });
        }
        currentMessageId = state.id;
        if (matches(state)) {
          await this.page.evaluate((id) => {
            const api = (window as BrowserWindowWithRustyView)
              .__RUSTY_VIEW_TEST__;
            api?.scrollToMessageId(id);
          }, currentMessageId);
          const row = this.messageById(currentMessageId);
          if (await row.isVisible().catch(() => false)) {
            return row;
          }
        }
      }
      // Let snapshots and CDK virtual scroll advance before resolving the
      // same user-anchored assistant position again.
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await this.page.waitForTimeout(50);
    }
    throw new Error(
      `Assistant row after user ${userMessageId} did not become visible within ${timeoutMs}ms` +
        (currentMessageId === undefined
          ? '.'
          : `; last correlated id was ${currentMessageId}.`),
    );
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
    const messageId = await assistant.getAttribute('data-message-id');
    if (messageId !== null) {
      await expect
        .poll(
          async () =>
            (await this.assistantMessageStates()).find(
              (message) => message.id === messageId,
            )?.status,
          { timeout: timeoutMs },
        )
        .toBe('completed');
    }

    await expect(assistant).toHaveAttribute(
      'data-message-status',
      'completed',
      {
        timeout: timeoutMs,
      },
    );
  }

  async waitForAssistantCompletedAfter(
    previousCount: number,
    timeoutMs: number,
  ): Promise<Locator> {
    await expect
      .poll(
        async () => {
          const latest = (await this.assistantMessageStates())
            .slice(previousCount)
            .at(-1);
          return latest?.status;
        },
        { timeout: timeoutMs },
      )
      .toBe('completed');

    const completedState = (await this.assistantMessageStates())
      .slice(previousCount)
      .at(-1);
    if (completedState === undefined) {
      throw new Error('Assistant completed but its message state disappeared.');
    }

    const assistant = this.messageById(completedState.id);
    await this.ensureMessageRowVisible(completedState.id, 10_000);
    await expect(assistant).toHaveAttribute('data-message-status', 'completed');
    return assistant;
  }

  async waitForAssistantCompletedAfterUser(
    userMessageId: string,
    timeoutMs: number,
  ): Promise<Locator> {
    await expect
      .poll(
        async () =>
          (await this.assistantMessageStatesAfterUser(userMessageId)).find(
            (message) => message.status === 'completed',
          )?.id ?? null,
        { timeout: timeoutMs },
      )
      .not.toBeNull();

    const completedState = (
      await this.assistantMessageStatesAfterUser(userMessageId)
    ).find((message) => message.status === 'completed');
    if (completedState === undefined) {
      throw new Error(
        'Assistant completed after the sent user message but its message state disappeared.',
      );
    }

    const assistant = this.messageById(completedState.id);
    await this.ensureMessageRowVisible(completedState.id, 10_000);
    await expect(assistant).toHaveAttribute('data-message-status', 'completed');
    return assistant;
  }

  async ensureMessageRowVisible(
    messageId: string,
    timeoutMs: number,
  ): Promise<void> {
    this.recordTimeline('transcript:scroll-to-message:start', { messageId });
    const row = this.messageById(messageId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.page.evaluate((id) => {
        const api = (window as BrowserWindowWithRustyView).__RUSTY_VIEW_TEST__;
        api?.scrollToMessageId(id);
      }, messageId);
      if (await row.isVisible().catch(() => false)) {
        this.recordTimeline('transcript:scroll-to-message:visible', {
          messageId,
        });
        return;
      }
      // Let CDK virtual scroll render the requested window before retrying.
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await this.page.waitForTimeout(250);
    }
    await expect(row).toBeVisible({ timeout: timeoutMs });
    this.recordTimeline('transcript:scroll-to-message:visible', { messageId });
  }

  async expectVisibleImpact(
    name: string,
    action: () => Promise<void>,
    options: VisualImpactOptions = {},
  ): Promise<void> {
    const region = options.region ?? this.page.getByTestId('transcript-shell');
    const beforeName = `${name}-before`;
    const afterName = `${name}-after`;
    const beforeText = await region.innerText().catch(() => '');
    const before = await this.screenshot(beforeName, region);
    await action();
    // Allow Angular rendering/layout to settle before comparing screenshots.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await this.page.waitForTimeout(options.settleMs ?? 300);
    const afterText = await region.innerText().catch(() => '');
    const after = await this.screenshot(afterName, region);

    const changedBytes = countChangedBytes(before, after);
    const minimum = options.minChangedBytes ?? 250;
    this.visualChecks.push({
      name,
      beforePath: this.artifactPath(`${beforeName}.png`),
      afterPath: this.artifactPath(`${afterName}.png`),
      changedBytes,
      minChangedBytes: minimum,
      beforeTextPreview: previewText(beforeText, 500),
      afterTextPreview: previewText(afterText, 500),
      capturedAtMs: Date.now(),
    });
    this.recordTimeline('visual-impact:checked', {
      name,
      changedBytes,
      minChangedBytes: minimum,
      beforeTextLength: beforeText.length,
      afterTextLength: afterText.length,
    });
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
    this.screenshots.push({
      name,
      path,
      fullPage: locator === undefined,
      capturedAtMs: Date.now(),
    });
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
        backendBaseUrl: api.getBackendBaseUrl(),
        activeSessionId: api.getActiveSessionId(),
        connectionStatus: api.getConnectionStatus(),
        isGenerating: api.getIsGenerating(),
        isStreaming: api.getIsStreaming(),
        streamingCharCount: api.getStreamingCharCount(),
        lastCursor: api.getLastCursor(),
        messageCount: api.getMessageCount(),
        rawEventCount: api.getRawEventCount(),
        messages: api.getMessages(),
      };
    });
  }

  async assistantStateCount(): Promise<number> {
    return (await this.assistantMessageStates()).length;
  }

  async userStateCount(): Promise<number> {
    const snapshot = await this.debugSnapshot();
    if (snapshot === null) {
      return 0;
    }
    return snapshot.messages.filter((message) => message.role === 'user')
      .length;
  }

  async latestAssistantState(): Promise<
    RustyViewDebugSnapshot['messages'][number] | undefined
  > {
    return (await this.assistantMessageStates()).at(-1);
  }

  async captureDebugSnapshot(
    name: string,
  ): Promise<RustyViewDebugSnapshot | null> {
    const snapshot = await this.debugSnapshot().catch(() => null);
    const path = this.artifactPath(`${sanitizeFileName(name)}-debug.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    this.debugSnapshots.push({
      name,
      path,
      capturedAtMs: Date.now(),
      snapshot,
    });
    this.recordTimeline('debug-snapshot:captured', {
      name,
      backendBaseUrl: snapshot?.backendBaseUrl,
      rawEventCount: snapshot?.rawEventCount,
      streamingCharCount: snapshot?.streamingCharCount,
      messageCount: snapshot?.messageCount,
      isStreaming: snapshot?.isStreaming,
      isGenerating: snapshot?.isGenerating,
    });
    return snapshot;
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

  messageById(messageId: string): Locator {
    return this.page.locator(
      `[data-testid="message-row"][data-message-id=${cssString(messageId)}]`,
    );
  }

  private assertFinalAssistantText(
    finalState: RustyViewDebugSnapshot['messages'][number] | undefined,
    options: LiveTurnOptions,
  ): void {
    expect(
      finalState,
      'completed assistant row should have a matching final debug state',
    ).toBeDefined();
    const text = finalState?.text.trim() ?? '';
    const failure = options.allowProviderFailureText
      ? null
      : providerFailureReason(text);
    if (failure !== null) {
      this.recordTimeline('turn:provider-failure-detected', {
        reason: failure,
        textPreview: previewText(text, 500),
      });
    }
    expect(
      failure,
      `final assistant text must be substantive, not a provider/runtime failure. Text: ${previewText(
        text,
        500,
      )}`,
    ).toBeNull();

    if (options.finalTextMinLength !== undefined) {
      expect(
        text.length,
        `final assistant text should contain at least ${options.finalTextMinLength} characters`,
      ).toBeGreaterThanOrEqual(options.finalTextMinLength);
    }

    for (const marker of options.finalTextMustInclude ?? []) {
      expect(
        text,
        `final assistant text should include marker "${marker}"`,
      ).toContain(marker);
    }
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

  private async ensureLiveProfileReady(): Promise<void> {
    if (this.profilePrepared) {
      return;
    }

    if (!this.profileIsolation.enabled) {
      this.profilePrepared = true;
      this.recordTimeline('profile:isolation-disabled', {
        targetProfile: this.targetProfile,
      });
      return;
    }

    const defaults = await this.resolveLiveProfileDefaults();
    const request = liveProfileCreateRequest({
      profileId: this.targetProfile,
      displayName: `Live ${this.testInfo.title}`,
      modelConfigId: defaults.modelConfigId,
      localToolProfileId: defaults.localToolProfileId,
      reason: `rusty-view live test isolation for ${this.testInfo.title}`,
    });
    this.profileIsolation.modelConfigId = defaults.modelConfigId;
    this.profileIsolation.localToolProfileId = defaults.localToolProfileId;
    this.profileIsolation.createRequest = request;

    this.recordTimeline('profile:create:start', {
      profileId: request.profileId,
      modelConfigId: request.modelConfigId,
      localToolProfileId: request.localToolProfileId,
    });
    const response = await fetch(
      `${this.backendUrl}/v1/admin/control/profiles`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Failed to create isolated live profile ${request.profileId}: HTTP ${response.status} ${text}`,
      );
    }

    const payload = parseJsonObject(text);
    const control = adminControlPayload(payload);
    const outcome = recordValue(control, 'outcome');
    const status = stringValue(outcome, 'status');
    if (status !== undefined && status !== 'completed') {
      const summary = stringValue(outcome, 'summary');
      const reasonCode = stringValue(outcome, 'reasonCode');
      throw new Error(
        `Failed to create isolated live profile ${request.profileId}: control status ${status}${
          reasonCode !== undefined ? ` (${reasonCode})` : ''
        }${summary !== undefined ? `: ${summary}` : ''}`,
      );
    }

    const result = recordValue(outcome, 'result');
    const sessionId = stringValue(result, 'sessionId');
    this.profileIsolation.createdAtMs = Date.now();
    if (sessionId !== undefined) {
      this.profileIsolation.createdSessionId = sessionId;
    }
    this.profilePrepared = true;
    this.recordTimeline('profile:create:complete', {
      profileId: request.profileId,
      sessionId,
    });
    this.note(
      `Created isolated live profile ${request.profileId} using model configuration ${request.modelConfigId} and local tool profile ${request.localToolProfileId}.`,
    );
  }

  private async cleanupIsolatedProfile(): Promise<void> {
    if (!this.profileIsolation.enabled || !this.profilePrepared) {
      return;
    }

    this.profileIsolation.cleanupAttemptedAtMs = Date.now();
    this.recordTimeline('profile:cleanup:start', {
      backendUrl: this.backendUrl,
      profileId: this.targetProfile,
    });

    const archivedSessionIds = await cleanupIsolatedLiveProfile({
      backendUrl: this.backendUrl,
      profileId: this.targetProfile,
      reason: `Rusty View live test cleanup for ${this.testInfo.title}`,
      idempotencyScope: String(this.startedAt),
    });
    this.profileIsolation.archivedSessionIds = archivedSessionIds;
    this.profileIsolation.profileDeletedAtMs = Date.now();
    this.recordTimeline('profile:cleanup:complete', {
      profileId: this.targetProfile,
      archivedSessionIds,
    });
    this.note(
      `Archived ${archivedSessionIds.length} isolated live session(s) and deleted profile ${this.targetProfile}.`,
    );
  }

  private async resolveLiveProfileDefaults(): Promise<{
    readonly modelConfigId: string;
    readonly localToolProfileId: string;
  }> {
    if (
      this.profileIsolation.modelConfigId !== undefined &&
      this.profileIsolation.localToolProfileId !== undefined
    ) {
      return {
        modelConfigId: this.profileIsolation.modelConfigId,
        localToolProfileId: this.profileIsolation.localToolProfileId,
      };
    }

    const sessionId = await this.sourceProfileSessionId();
    if (sessionId !== undefined) {
      const context = await this.fetchJson(
        `/v1/chat/sessions/${encodeURIComponent(sessionId)}/context`,
      );
      const data = adminControlPayload(context);
      const provider = recordValue(data, 'provider');
      const tools = recordValue(data, 'tools');
      const modelConfigId =
        this.profileIsolation.modelConfigId ??
        stringValue(provider, 'model_config_id') ??
        stringValue(provider, 'modelConfigId') ??
        stringValue(provider, 'alias');
      const localToolProfileId =
        this.profileIsolation.localToolProfileId ??
        stringValue(tools, 'local_tool_profile_id') ??
        stringValue(tools, 'localToolProfileId');
      if (modelConfigId !== undefined && localToolProfileId !== undefined) {
        this.recordTimeline('profile:create:defaults-derived', {
          sourceProfile: this.sourceProfile,
          sessionId,
          modelConfigId,
          localToolProfileId,
        });
        return { modelConfigId, localToolProfileId };
      }
    }

    const modelConfigId = this.profileIsolation.modelConfigId ?? 'default';
    const localToolProfileId =
      this.profileIsolation.localToolProfileId ?? 'full_agent';
    this.recordTimeline('profile:create:defaults-fallback', {
      sourceProfile: this.sourceProfile,
      modelConfigId,
      localToolProfileId,
    });
    return { modelConfigId, localToolProfileId };
  }

  private async sourceProfileSessionId(): Promise<string | undefined> {
    const payload = await this.fetchJson('/v1/chat/sessions');
    const data = adminControlPayload(payload);
    const items = data['items'];
    if (!Array.isArray(items)) {
      return undefined;
    }
    const matching = items.find((item) => {
      if (!isRecord(item)) return false;
      return (
        stringValue(item, 'profile_id') === this.sourceProfile &&
        stringValue(item, 'status') !== 'archived'
      );
    });
    return isRecord(matching) ? stringValue(matching, 'session_id') : undefined;
  }

  private async fetchJson(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.backendUrl}${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Rusty Crew request failed for ${path}: HTTP ${response.status} ${text}`,
      );
    }
    return parseJsonObject(text);
  }

  private async assistantMessageStates(): Promise<
    RustyViewDebugSnapshot['messages']
  > {
    const snapshot = await this.debugSnapshot();
    if (snapshot === null) {
      return [];
    }
    return snapshot.messages.filter((message) => message.role === 'assistant');
  }

  private async userMessageStates(): Promise<
    RustyViewDebugSnapshot['messages']
  > {
    const snapshot = await this.debugSnapshot();
    if (snapshot === null) {
      return [];
    }
    return snapshot.messages.filter((message) => message.role === 'user');
  }

  private async assistantMessageStatesAfterUser(
    userMessageId: string,
  ): Promise<RustyViewDebugSnapshot['messages']> {
    const snapshot = await this.debugSnapshot();
    if (snapshot === null) {
      return [];
    }
    return assistantMessageStatesAfterUser(snapshot.messages, userMessageId);
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

  private recordTimeline(
    name: string,
    details?: Record<string, unknown>,
  ): void {
    const atMs = Date.now();
    this.timeline.push({
      name,
      atMs,
      elapsedMs: atMs - this.startedAt,
      ...(details === undefined ? {} : { details }),
    });
  }

  private evidencePacket(
    visibleTranscriptText: string,
    finalDebugSnapshot: RustyViewDebugSnapshot | null,
  ): unknown {
    return {
      schemaVersion: 1,
      test: {
        title: this.testInfo.title,
        project: this.testInfo.project.name,
        status: this.testInfo.status,
        expectedStatus: this.testInfo.expectedStatus,
        durationMs: this.testInfo.duration,
        retry: this.testInfo.retry,
      },
      environment: {
        baseUrl: env('BASE_URL') ?? null,
        backendUrl: this.backendUrl,
        appUrl: this.appUrl,
        renderedBackendUrl: this.renderedBackendUrl,
        sourceProfile: this.sourceProfile,
        targetProfile: this.targetProfile,
        profileIsolation: this.profileIsolation,
        currentUrl: this.page.url(),
      },
      startedAtMs: this.startedAt,
      finishedAtMs: Date.now(),
      consoleEntries: this.consoleEntries,
      pageErrors: this.pageErrors,
      screenshots: this.screenshots,
      debugSnapshots: this.debugSnapshots.map((entry) => ({
        name: entry.name,
        path: entry.path,
        capturedAtMs: entry.capturedAtMs,
        backendBaseUrl: entry.snapshot?.backendBaseUrl,
        streamingCharCount: entry.snapshot?.streamingCharCount,
        rawEventCount: entry.snapshot?.rawEventCount,
        messageCount: entry.snapshot?.messageCount,
        isStreaming: entry.snapshot?.isStreaming,
        isGenerating: entry.snapshot?.isGenerating,
        activeSessionId: entry.snapshot?.activeSessionId,
        connectionStatus: entry.snapshot?.connectionStatus,
        lastCursor: entry.snapshot?.lastCursor,
      })),
      turns: this.turns,
      visualChecks: this.visualChecks,
      timeline: this.timeline,
      finalDebugSnapshot,
      visibleTranscriptText,
      summaryLines: this.summaryLines,
      humanInspectionRequired: true,
      closeCriteria:
        'Inspect screenshots, visible transcript, trace, and evidence timeline before claiming live UI behavior works. Deterministic assertions are guardrails, not proof.',
    };
  }

  private nextArtifactName(label: string): string {
    return `${String(this.summaryLines.length).padStart(2, '0')}-${label}`;
  }

  private summaryMarkdown(): string {
    return [
      '# Rusty View Live Scenario Summary',
      '',
      `- Backend: ${this.backendUrl}`,
      `- Rendered backend: ${this.renderedBackendUrl ?? '<not captured>'}`,
      `- App URL: ${this.appUrl}`,
      `- Source profile: ${this.sourceProfile}`,
      `- Requested profile: ${this.targetProfile}`,
      `- Profile isolation: ${
        this.profileIsolation.enabled ? 'enabled' : 'disabled'
      }`,
      `- Console entries: ${this.consoleEntries.length}`,
      `- Page errors: ${this.pageErrors.length}`,
      `- Screenshots: ${this.screenshots.length}`,
      `- Debug snapshots: ${this.debugSnapshots.length}`,
      `- Timeline events: ${this.timeline.length}`,
      `- Evidence packet: ${this.artifactPath('evidence-packet.json')}`,
      '',
      '## Evidence Log',
      '',
      ...this.summaryLines.map((line) => `- ${line}`),
      '',
    ].join('\n');
  }

  private async assertRenderedBackendMatchesFixture(): Promise<void> {
    const expected = canonicalBackendUrl(this.backendUrl);
    const renderedQueryBackend = canonicalBackendUrl(
      await this.page.evaluate(
        () => new URL(window.location.href).searchParams.get('api') ?? '',
      ),
    );
    expect(
      renderedQueryBackend,
      'live rendered app must carry the same ?api backend as the fixture setup',
    ).toBe(expected);

    const renderedTransportBackend = canonicalBackendUrl(
      await this.page.evaluate(() => {
        const api = (window as BrowserWindowWithRustyView).__RUSTY_VIEW_TEST__;
        return api?.getBackendBaseUrl() ?? '';
      }),
    );
    expect(
      renderedTransportBackend,
      'live rendered app transport backend must match fixture setup backend',
    ).toBe(expected);

    this.renderedBackendUrl = renderedTransportBackend;
    this.recordTimeline('app:backend-verified', {
      backendUrl: expected,
      renderedQueryBackend,
      renderedTransportBackend,
      currentUrl: this.page.url(),
    });
  }
}

function env(name: string): string | undefined {
  return process.env[name];
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(errorMessage(value));
}

export function isolatedLiveProfileId(input: IsolatedProfileIdInput): string {
  const prefix = sanitizeProfileId(input.prefix) || 'live';
  const title = sanitizeProfileId(input.title).slice(0, 48) || 'scenario';
  const nonce = input.startedAtMs.toString(36);
  return sanitizeProfileId(
    `${prefix}-${title}-w${input.workerIndex}-r${input.retry}-${nonce}`,
  ).slice(0, 96);
}

export function liveProfileIsolationPrefix(
  input: LiveProfileIsolationPrefixInput,
): string | undefined {
  if (isDisabledFlag(input.profileIsolation)) {
    return undefined;
  }
  const explicit = input.profilePrefix?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  if (input.liveRun === '1') {
    return 'rv-live';
  }
  return undefined;
}

export function liveProfileCreateRequest(input: {
  readonly profileId: string;
  readonly displayName: string;
  readonly modelConfigId: string;
  readonly localToolProfileId: string;
  readonly reason: string;
}): LiveProfileCreateRequest {
  return {
    profileId: input.profileId,
    displayName: input.displayName.slice(0, 120),
    modelConfigId: input.modelConfigId,
    kind: 'full',
    localToolProfileId: input.localToolProfileId,
    reason: input.reason,
  };
}

export function liveAppUrlForBackend(backendUrl: string): string {
  const params = new URLSearchParams({
    api: canonicalBackendUrl(backendUrl),
  });
  return `/?${params.toString()}`;
}

export function findSentUserMessage(
  messages: RustyViewDebugSnapshot['messages'],
  prompt: string,
  previousUserCount: number,
): RustyViewDebugSnapshot['messages'][number] | undefined {
  return messages
    .filter((message) => message.role === 'user')
    .slice(previousUserCount)
    .find((message) => message.text.trim() === prompt.trim());
}

export function assistantMessageStatesAfterUser(
  messages: RustyViewDebugSnapshot['messages'],
  userMessageId: string,
): RustyViewDebugSnapshot['messages'] {
  const userIndex = messages.findIndex(
    (message) => message.id === userMessageId,
  );
  if (userIndex === -1) {
    return [];
  }
  return messages
    .slice(userIndex + 1)
    .filter((message) => message.role === 'assistant');
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function sanitizeProfileId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function canonicalBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isDisabledFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'off' ||
    normalized === 'disabled'
  );
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object response from Rusty Crew admin API.');
  }
  return parsed;
}

function adminControlPayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const data = recordValue(value, 'data');
  return data ?? value;
}

function recordValue(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const child = value?.[key];
  return isRecord(child) ? child : undefined;
}

function stringValue(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const child = value?.[key];
  return typeof child === 'string' ? child : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cssString(value: string): string {
  return JSON.stringify(value);
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

function previewText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength - 3) + '...';
}

function providerFailureReason(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return 'empty_final_text';
  const checks: readonly [string, RegExp][] = [
    ['openai_responses_wake_failed', /\bOpenAI Responses wake\b.*\bfailed\b/i],
    ['provider_stream_idle_timeout', /\bprovider stream idle timeout\b/i],
    ['wake_dispatch_failed', /\bwake_dispatch_failed\b/i],
    ['provider_transport_error', /\bprovider transport error\b/i],
    ['failed_provider', /\bfailed:\s*provider\b/i],
  ];
  for (const [reason, pattern] of checks) {
    if (pattern.test(normalized)) return reason;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
