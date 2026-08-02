import { expect, test, type Locator, type Page } from '@playwright/test';

test('persists panel sizing and configurable hotkeys in a real browser', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();

  await page.getByTestId('appearance-composer-height').fill('160');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--rv-composer-height')
          .trim(),
      ),
    )
    .toBe('160px');

  await page.getByTestId('appearance-sidebar-width').fill('360');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--rv-sidebar-width')
          .trim(),
      ),
    )
    .toBe('360px');
  await expect(page.locator('.rv-debug__sidebar')).toHaveCSS('width', '360px');
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.locator('.rv-debug__sidebar')).toHaveCSS('width', '360px');

  await page.getByTestId('appearance-message-actions').uncheck();
  await page.getByTestId('appearance-session-status-bar').uncheck();

  await page.locator('.rv-tab-strip__tab', { hasText: 'Hotkeys' }).click();
  const nextRow = page.locator('[data-hotkey-action="nextSession"]');
  await nextRow.getByTestId('hotkey-record').click();
  await page.keyboard.press('Alt+n');
  await expect(nextRow.getByTestId('hotkey-binding')).toHaveText('Alt+N');

  await page.locator('.rv-options__close').click();
  await page.getByTestId('profiles-toggle').click();
  await page.getByTestId('inspector-toggle').click();
  await expect
    .poll(() => readAppearanceSetting(page, 'showInspector'))
    .toBe(false);
  await page.reload();
  await expect(page.getByTestId('profiles-toggle')).toHaveText('Show Agents');
  await expect(page.getByTestId('inspector-toggle')).toHaveText(
    'Show Inspector',
  );
  await page.getByTestId('profiles-toggle').click();
  await expect(page.locator('.rv-debug__sidebar')).toHaveCSS('width', '360px');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await expect(
    page.getByTestId('appearance-message-actions'),
  ).not.toBeChecked();
  await expect(
    page.getByTestId('appearance-session-status-bar'),
  ).not.toBeChecked();
  await page.locator('.rv-tab-strip__tab', { hasText: 'Hotkeys' }).click();
  await expect(
    page
      .locator('[data-hotkey-action="nextSession"]')
      .getByTestId('hotkey-binding'),
  ).toHaveText('Alt+N');
  await page.getByTestId('hotkeys-reset-all').click();
});

async function readAppearanceSetting(
  page: Page,
  key: 'showInspector' | 'autoExpandReasoning' | 'sidebarWidthPx',
): Promise<unknown> {
  return page.evaluate(
    (settingKey) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('rusty-view-chat');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('settings', 'readonly');
          const get = transaction.objectStore('settings').get('appearance');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            const settings = get.result as Record<string, unknown> | undefined;
            resolve(settings?.[settingKey]);
            db.close();
          };
        };
      }),
    key,
  );
}

test('requested shortcuts cycle non-archived sessions and erase a composer word', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  const agentRows = page.getByTestId('external-agent-row');
  await expect(agentRows).toHaveCount(3);

  await agentRows.first().click();
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-surface',
    'agent',
  );
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-activity',
    'idle',
  );
  await expect(page.getByTestId('external-current-model')).toHaveText(
    'gpt-5.6-sol',
  );
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('[data-thread-id="thread-2"]')).toHaveClass(
    /rv-agent--selected/,
  );
  await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
    'data-activity',
    'working',
  );
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('[data-thread-id="thread-1"]')).toHaveClass(
    /rv-agent--selected/,
  );
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.locator('[data-thread-id="thread-2"]')).toHaveClass(
    /rv-agent--selected/,
  );
  await expect(
    page.locator('[data-thread-id="thread-archived"]'),
  ).not.toHaveClass(/rv-agent--selected/);
  await expect(
    page.locator('[data-thread-id="thread-native-hidden"]'),
  ).toHaveCount(0);

  const composer = page.getByTestId('message-input-field');
  await composer.fill('hello brave world');
  await composer.press('Control+w');
  await expect(composer).toHaveValue('hello brave ');
});

test('scroll-to-latest control recovers an overflowing transcript', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const transcript = page.getByTestId('transcript-viewport');
  await expect
    .poll(() =>
      transcript.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          overflowAnchor: style.overflowAnchor,
          scrollBehavior: style.scrollBehavior,
        };
      }),
    )
    .toEqual({ overflowAnchor: 'auto', scrollBehavior: 'auto' });
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 80,
      ),
    )
    .toBe(true);

  await transcript.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: bounds.right - 1,
        clientY: bounds.top + 20,
      }),
    );
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  const latest = page.getByTestId('transcript-scroll-to-bottom');
  await expect(latest).toBeVisible();
  await latest.evaluate((button: HTMLButtonElement) => button.click());
  await transcript.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: bounds.right - 1,
        clientY: bounds.top + 20,
      }),
    );
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  const heldScrollTop = await transcript.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        setTimeout(() => resolve(element.scrollTop), 750);
      }),
  );
  expect(heldScrollTop).toBeLessThanOrEqual(1);
  await expect(latest).toBeVisible();

  await latest.evaluate((button: HTMLButtonElement) => button.click());
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
  await page.waitForTimeout(200);

  const originalHeight = await transcript.evaluate((element) => {
    const height = element.getBoundingClientRect().height;
    element.style.height = `${Math.max(80, height - 160)}px`;
    return height;
  });
  await expect
    .poll(async () => {
      const bottomOffset = await transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      );
      return bottomOffset <= 80 || (await latest.isVisible());
    })
    .toBe(true);

  await transcript.evaluate((element, height) => {
    element.style.height = `${height}px`;
  }, originalHeight);
  await expect
    .poll(async () => {
      const bottomOffset = await transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      );
      return bottomOffset <= 80 || (await latest.isVisible());
    })
    .toBe(true);
});

test('rapid streamed tail growth stays visually pinned without blank frames', async ({
  page,
}) => {
  const fixture = await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByLabel('Reduced Motion').check();
  await page.locator('.rv-options__close').click();
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const transcript = page.getByTestId('transcript-viewport');
  const latest = page.getByTestId('transcript-scroll-to-bottom');
  await latest.evaluateAll((buttons: HTMLButtonElement[]) =>
    buttons.at(0)?.click(),
  );
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);

  fixture.startGrowingTail();
  await page.getByTestId('external-agent-refresh').click();
  await expect(transcript).toContainText('Streaming growth begins.');
  await transcript.evaluate((viewport) => {
    type TailGeometrySample = {
      tailGap: number;
      bottomOffset: number;
      renderedEndMismatch: number;
      lastMessageId: string | undefined;
    };
    const state = window as typeof window & {
      __rvTailGeometrySamples?: TailGeometrySample[];
      __rvTailGeometryCapture?: boolean;
    };
    state.__rvTailGeometrySamples = [];
    state.__rvTailGeometryCapture = true;

    const sampleAfterFrame = (): void => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!state.__rvTailGeometryCapture) return;
          const content = viewport.querySelector<HTMLElement>(
            '.rv-transcript__owned-window-content',
          );
          const items = viewport.querySelectorAll<HTMLElement>(
            '.rv-transcript__item',
          );
          const lastItem = items.item(items.length - 1);
          if (content !== null && lastItem !== null) {
            const viewportBounds = viewport.getBoundingClientRect();
            const lastBounds = lastItem.getBoundingClientRect();
            const renderedContentEnd =
              viewport.scrollTop + lastBounds.bottom - viewportBounds.top;
            state.__rvTailGeometrySamples?.push({
              tailGap: viewportBounds.bottom - lastBounds.bottom,
              bottomOffset:
                viewport.scrollHeight -
                viewport.scrollTop -
                viewport.clientHeight,
              renderedEndMismatch: renderedContentEnd - viewport.scrollHeight,
              lastMessageId: lastItem.dataset['messageId'],
            });
          }
          sampleAfterFrame();
        }, 0);
      });
    };
    sampleAfterFrame();
  });

  for (let index = 0; index < 12; index += 1) {
    fixture.growTail(
      `\nStreaming line ${index}: ${'variable-height content '.repeat(10)}`,
    );
    await page.getByTestId('external-agent-refresh').click();
    await expect(transcript).toContainText(`Streaming line ${index}`);
  }

  await transcript.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 400)),
  );
  const samples = await page.evaluate(() => {
    const state = window as typeof window & {
      __rvTailGeometrySamples?: Array<{
        tailGap: number;
        bottomOffset: number;
        renderedEndMismatch: number;
        lastMessageId: string | undefined;
      }>;
      __rvTailGeometryCapture?: boolean;
    };
    state.__rvTailGeometryCapture = false;
    return state.__rvTailGeometrySamples ?? [];
  });
  expect(samples.length).toBeGreaterThan(0);
  expect(
    samples.every(
      (sample) =>
        sample.tailGap <= 2 &&
        sample.bottomOffset <= 80 &&
        Math.abs(sample.renderedEndMismatch) <= 2 &&
        sample.lastMessageId ===
          'external:thread-1:streaming-growth-turn:assistant',
    ),
    JSON.stringify(
      samples.filter(
        (sample) =>
          sample.tailGap > 2 ||
          sample.bottomOffset > 80 ||
          Math.abs(sample.renderedEndMismatch) > 2 ||
          sample.lastMessageId !==
            'external:thread-1:streaming-growth-turn:assistant',
      ),
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
});

test('multi-item Codex turns keep one coherent virtual tail while streaming', async ({
  page,
}) => {
  const fixture = await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByLabel('Reduced Motion').check();
  await page.getByTestId('appearance-auto-expand-reasoning').check();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.transition = 'opacity 5s';
        probe.style.animation = 'pulse 5s infinite';
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const result = {
          transitionDuration: style.transitionDuration,
          animationDuration: style.animationDuration,
        };
        probe.remove();
        return result;
      }),
    )
    .toEqual({ transitionDuration: '0s', animationDuration: '0s' });
  await page.locator('.rv-options__close').click();
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const transcript = page.getByTestId('transcript-viewport');
  await page
    .getByTestId('transcript-scroll-to-bottom')
    .evaluateAll((buttons: HTMLButtonElement[]) => buttons.at(0)?.click());
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);

  await transcript.evaluate((viewport) => {
    type MultiItemGeometrySample = {
      frame: number;
      tailGap: number;
      bottomOffset: number;
      renderedEndMismatch: number;
      viewportCoverageGap: number;
      turnRowCount: number;
      turnMessageCount: number;
      turnBlockCount: number;
      lastVirtualRowId: string | undefined;
      lastMessageId: string | undefined;
      lastMessageStatus: string | undefined;
      finalMessageStatus: string | undefined;
    };
    const state = window as typeof window & {
      __rvMultiItemGeometrySamples?: MultiItemGeometrySample[];
      __rvMultiItemGeometryCapture?: boolean;
    };
    state.__rvMultiItemGeometrySamples = [];
    state.__rvMultiItemGeometryCapture = true;
    let frame = 0;

    const sampleAfterFrame = (): void => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!state.__rvMultiItemGeometryCapture) return;
          frame += 1;
          const content = viewport.querySelector<HTMLElement>(
            '.rv-transcript__owned-window-content',
          );
          const items = viewport.querySelectorAll<HTMLElement>(
            '.rv-transcript__item',
          );
          const lastItem = items.item(items.length - 1);
          const virtualRows = viewport.querySelectorAll<HTMLElement>(
            '[data-testid="transcript-virtual-row"]',
          );
          const lastVirtualRow = virtualRows.item(virtualRows.length - 1);
          const turnRows = viewport.querySelectorAll<HTMLElement>(
            '[data-virtual-row-id="message:external:thread-1:multi-item-turn:assistant"]',
          );
          const turnRow = turnRows.item(0);
          const finalMessage = viewport.querySelector<HTMLElement>(
            '[data-testid="transcript-item"][data-message-id="external:thread-1:multi-item-turn:assistant"]',
          );
          const finalMessageRow =
            finalMessage?.querySelector<HTMLElement>(
              '[data-testid="message-row"]',
            ) ?? null;
          if (content !== null && lastItem !== null) {
            const viewportBounds = viewport.getBoundingClientRect();
            const contentBounds = content.getBoundingClientRect();
            const lastBounds = lastItem.getBoundingClientRect();
            const renderedContentEnd =
              viewport.scrollTop + lastBounds.bottom - viewportBounds.top;
            state.__rvMultiItemGeometrySamples?.push({
              frame,
              tailGap: viewportBounds.bottom - lastBounds.bottom,
              bottomOffset:
                viewport.scrollHeight -
                viewport.scrollTop -
                viewport.clientHeight,
              renderedEndMismatch: renderedContentEnd - viewport.scrollHeight,
              viewportCoverageGap: Math.max(
                0,
                contentBounds.top - viewportBounds.top,
              ),
              turnRowCount: turnRows.length,
              turnMessageCount:
                turnRow?.querySelectorAll('[data-testid="transcript-item"]')
                  .length ?? 0,
              turnBlockCount:
                turnRow?.querySelectorAll('rv-message-block').length ?? 0,
              lastVirtualRowId: lastVirtualRow?.dataset['virtualRowId'],
              lastMessageId: lastItem.dataset['messageId'],
              lastMessageStatus: lastItem.querySelector<HTMLElement>(
                '[data-testid="message-row"]',
              )?.dataset['messageStatus'],
              finalMessageStatus: finalMessageRow?.dataset['messageStatus'],
            });
          }
          sampleAfterFrame();
        }, 0);
      });
    };
    sampleAfterFrame();
  });

  for (let step = 0; step < 6; step += 1) {
    const marker = fixture.appendMultiItemTurnStep(step);
    await page.getByTestId('external-agent-refresh').click();
    await expect(page.getByTestId('transcript-shell')).toContainText(marker);

    const turnRows = transcript.locator(
      '[data-virtual-row-id="message:external:thread-1:multi-item-turn:assistant"]',
    );
    await expect(turnRows).toHaveCount(1);
    await expect(
      turnRows.locator('[data-testid="transcript-item"]'),
    ).toHaveCount(1);
    await expect(turnRows.locator('rv-message-block')).toHaveCount(step + 1);
    await transcript.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  fixture.completeMultiItemTurn();
  await page.getByTestId('external-agent-refresh').click();
  await expect(
    transcript.locator(
      '[data-testid="transcript-item"][data-message-id="external:thread-1:multi-item-turn:assistant"] [data-testid="message-row"]',
    ),
  ).toHaveAttribute('data-message-status', 'completed');
  await transcript.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const samples = await page.evaluate(() => {
    const state = window as typeof window & {
      __rvMultiItemGeometrySamples?: Array<{
        frame: number;
        tailGap: number;
        bottomOffset: number;
        renderedEndMismatch: number;
        viewportCoverageGap: number;
        turnRowCount: number;
        turnMessageCount: number;
        turnBlockCount: number;
        lastVirtualRowId: string | undefined;
        lastMessageId: string | undefined;
        lastMessageStatus: string | undefined;
        finalMessageStatus: string | undefined;
      }>;
      __rvMultiItemGeometryCapture?: boolean;
    };
    state.__rvMultiItemGeometryCapture = false;
    return state.__rvMultiItemGeometrySamples ?? [];
  });

  const firstTurnSample = samples.findIndex(
    (sample) => sample.turnRowCount > 0,
  );
  expect(firstTurnSample).toBeGreaterThanOrEqual(0);
  const turnSamples = samples.slice(firstTurnSample);
  expect(turnSamples.length).toBeGreaterThan(0);

  let priorBlockCount = 0;
  const invalidSamples = turnSamples.filter((sample) => {
    const reversed = sample.turnBlockCount < priorBlockCount;
    priorBlockCount = Math.max(priorBlockCount, sample.turnBlockCount);
    return (
      sample.turnRowCount !== 1 ||
      sample.lastVirtualRowId !==
        'message:external:thread-1:multi-item-turn:assistant' ||
      sample.lastMessageId !== 'external:thread-1:multi-item-turn:assistant' ||
      sample.turnMessageCount !== 1 ||
      sample.turnBlockCount < 1 ||
      reversed ||
      sample.tailGap > 2 ||
      sample.bottomOffset > 80 ||
      Math.abs(sample.renderedEndMismatch) > 2 ||
      sample.viewportCoverageGap > 2
    );
  });
  expect(invalidSamples, JSON.stringify(invalidSamples)).toEqual([]);
  expect(new Set(turnSamples.map((sample) => sample.turnBlockCount))).toEqual(
    new Set([1, 2, 3, 4, 5, 6]),
  );

  const finalSample = turnSamples.at(-1);
  expect(finalSample).toMatchObject({
    turnRowCount: 1,
    turnMessageCount: 1,
    turnBlockCount: 6,
    lastVirtualRowId: 'message:external:thread-1:multi-item-turn:assistant',
    lastMessageId: 'external:thread-1:multi-item-turn:assistant',
    finalMessageStatus: 'completed',
  });
  expect(finalSample?.tailGap).toBeLessThanOrEqual(2);
  expect(finalSample?.bottomOffset).toBeLessThanOrEqual(80);
  expect(
    Math.abs(finalSample?.renderedEndMismatch ?? Infinity),
  ).toBeLessThanOrEqual(2);
  expect(finalSample?.viewportCoverageGap).toBeLessThanOrEqual(2);
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
  await expect(
    transcript.locator(
      '[data-virtual-row-id="message:external:thread-1:multi-item-turn:assistant"]',
    ),
  ).toHaveCount(1);
  await expect(page.getByTestId('transcript-shell')).toContainText(
    'Multi-item final answer.',
  );
});

test('an upward gesture near the tail keeps user scroll control during Codex updates', async ({
  page,
}) => {
  const fixture = await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const transcript = page.getByTestId('transcript-viewport');
  const latest = page.getByTestId('transcript-scroll-to-bottom');
  await latest.evaluateAll((buttons: HTMLButtonElement[]) =>
    buttons.at(0)?.click(),
  );
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
  await transcript.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 500)),
  );

  await transcript.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, deltaY: -40 }),
    );
    element.scrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight - 40,
    );
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(latest).toBeVisible();
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(1);

  fixture.startGrowingTail();
  await page.getByTestId('external-agent-refresh').click();
  await expect(page.getByTestId('transcript-shell')).toContainText(
    'Streaming growth begins.',
  );
  await transcript.evaluate(
    () => new Promise<void>((resolve) => setTimeout(resolve, 500)),
  );

  await expect(transcript).toHaveAttribute('data-tail-following', 'false');
  const bottomOffset = await transcript.evaluate((element) =>
    Math.max(
      0,
      element.scrollHeight - element.scrollTop - element.clientHeight,
    ),
  );
  expect(bottomOffset).toBeGreaterThan(1);
  await expect(latest).toBeVisible();
});

test('session cycling does not leave blank space after the transcript tail', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByTestId('appearance-auto-expand-reasoning').check();
  await page.locator('.rv-options__close').click();
  await page.getByTestId('external-agents-tab').click();
  await page.getByTestId('external-agent-mode-all').click();

  const transcript = page.getByTestId('transcript-viewport');
  const tailIds = new Map([
    ['thread-1', 'external:thread-1:turn-1:assistant'],
    [
      'thread-native-hidden',
      'external:thread-native-hidden:turn-native:assistant',
    ],
  ]);
  for (let cycle = 0; cycle < 6; cycle += 1) {
    for (const threadId of ['thread-1', 'thread-native-hidden']) {
      await page.locator(`[data-thread-id="${threadId}"]`).click();
      await expect(
        transcript.locator('.rv-transcript__item').last(),
      ).toHaveAttribute('data-message-id', tailIds.get(threadId) ?? '');
      const geometry = await transcriptGeometryAfter(transcript, 700);
      expect(
        {
          tailAligned: geometry.tailGap <= 2,
          atBottom: geometry.bottomOffset <= 80,
          wrapperEndCoherent: Math.abs(geometry.renderedEndMismatch) <= 2,
          viewportCovered: geometry.viewportCoverageGap <= 2,
        },
        JSON.stringify(geometry),
      ).toEqual({
        tailAligned: true,
        atBottom: true,
        wrapperEndCoherent: true,
        viewportCovered: true,
      });
    }
  }
});

test('auto-expand reasoning is live, manually collapsible, and persisted', async ({
  page,
}) => {
  await installExternalSessionFixture(page);
  await page.goto('/?api=http://crew.test');
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();

  const reasoningToggle = page.getByTestId('reasoning-toggle').last();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false');

  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await page.getByTestId('appearance-auto-expand-reasoning').check();
  await page.locator('.rv-options__close').click();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('reasoning-content').last()).toContainText(
    'Inspect the final state',
  );

  const transcript = page.getByTestId('transcript-viewport');
  const latest = page.getByTestId('transcript-scroll-to-bottom');
  await latest.evaluateAll((buttons: HTMLButtonElement[]) =>
    buttons.at(0)?.click(),
  );
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(80);
  expect(await transcriptTailGapAfter(transcript, 700)).toBeLessThanOrEqual(2);

  await reasoningToggle.click();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await transcriptTailGapAfter(transcript, 300)).toBeLessThanOrEqual(2);
  await expect
    .poll(() => readAppearanceSetting(page, 'autoExpandReasoning'))
    .toBe(true);

  await page.reload();
  await page.getByTestId('external-agents-tab').click();
  await page.locator('[data-thread-id="thread-1"]').click();
  await expect(page.getByTestId('reasoning-toggle').last()).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

interface ExternalSessionFixtureController {
  startGrowingTail(): void;
  growTail(text: string): void;
  appendMultiItemTurnStep(step: number): string;
  completeMultiItemTurn(): void;
}

async function installExternalSessionFixture(
  page: Page,
): Promise<ExternalSessionFixtureController> {
  const runtime = {
    runtimeId: 'runtime-1',
    kind: 'codex_app_server',
    desiredState: 'enabled',
    observedState: 'ready',
    processOwnership: 'attached',
    endpoint: { transport: 'unix_web_socket', address: '/run/codex.sock' },
    executableSha256: 'exe',
    protocolSchemaSha256: 'schema',
    expectedCliVersion: '0.144.1',
    revision: 1,
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
  };
  const baseThread = {
    sessionId: 'session-1',
    parentThreadId: null,
    preview: 'Session',
    ephemeral: false,
    modelProvider: 'openai',
    effectiveModel: 'gpt-5.6-sol',
    createdAt: 1,
    updatedAt: 2,
    status: 'idle',
    cwd: '/home/dev/rusty-view',
    cliVersion: '0.144.1',
    name: null,
    agentNickname: null,
    agentRole: null,
    turns: [],
  };
  const longItems = Array.from({ length: 120 }, (_, index) => ({
    itemId: `item-${index}`,
    kind: 'agentMessage',
    text: `Transcript row ${index}: ${'content '.repeat(12)}`,
  }));
  longItems.push({
    itemId: 'reasoning-visible',
    kind: 'reasoning',
    text: [
      'Inspect the final state before answering.',
      ...Array.from(
        { length: 180 },
        (_, index) =>
          `Expanded reasoning line ${index}: ${'variable-height analysis '.repeat(
            index % 7 === 0 ? 12 : 2,
          )}`,
      ),
    ].join('\n'),
  });
  const secondItems = Array.from({ length: 55 }, (_, index) => ({
    itemId: `second-item-${index}`,
    kind: 'agentMessage',
    text: `Second transcript row ${index}: ${'variable content '.repeat(
      index % 5 === 0 ? 40 : 4,
    )}`,
  }));
  secondItems.push({
    itemId: 'second-tail',
    kind: 'agentMessage',
    text: 'Second transcript tail.',
  });
  const threads = [
    {
      ...baseThread,
      threadId: 'thread-1',
      preview: 'First active session',
      turns: [
        {
          turnId: 'turn-1',
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          items: longItems,
        },
      ],
    },
    {
      ...baseThread,
      threadId: 'thread-2',
      preview: 'Second active session',
      status: 'active',
    },
    {
      ...baseThread,
      threadId: 'thread-archived',
      preview: 'Archived session',
      status: 'archived',
    },
    {
      ...baseThread,
      threadId: 'thread-native-hidden',
      preview: 'Native history outside the managed inventory',
      turns: [
        {
          turnId: 'turn-native',
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          items: secondItems,
        },
      ],
    },
  ];
  const bindings = threads
    .filter((thread) => thread.threadId !== 'thread-native-hidden')
    .map((thread, index) => ({
      bindingId: `binding-${index}`,
      runtimeId: 'runtime-1',
      nativeThreadId: thread.threadId,
      sessionId: `session-${index}`,
      agentId: `agent-${index}`,
      purpose: 'crew_agent',
      status: 'active',
      cwd: '/home/dev/rusty-view',
      taskRef: { project_id: 'rusty-view', task_id: '5703' },
      effectiveConfigFingerprint: 'config',
      revision: 1,
      createdAt: '2026-07-12T00:00:00Z',
      updatedAt: '2026-07-12T00:00:00Z',
    }));
  const growingTailEvents: Array<Record<string, unknown>> = [];
  let growingSequence = 1;

  await page.route('http://crew.test/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let data: unknown;
    if (pathname === '/v1/admin/profiles/registry') {
      data = { items: [], total: 0, limit: 100, offset: 0 };
    } else if (pathname === '/v1/external-runtimes') {
      data = {
        runtimes: [runtime],
        controllers: [
          {
            runtimeId: 'runtime-1',
            driverState: 'ready',
            controllerInstanceId: 'controller-1',
            controllerGeneration: 1,
            leaseExpiresAt: '2026-07-12T01:00:00Z',
            bindingResumeFailures: [],
          },
        ],
      };
    } else if (pathname === '/v1/external-bindings') {
      data = { bindings };
    } else if (pathname === '/v1/external-interactions') {
      data = { interactions: [] };
    } else if (pathname.endsWith('/threads/read')) {
      const body = request.postDataJSON() as { threadId?: string };
      data = {
        thread: threads.find((thread) => thread.threadId === body.threadId),
      };
    } else if (pathname.endsWith('/threads')) {
      data = { items: threads, nextCursor: null, backwardsCursor: null };
    } else if (pathname.endsWith('/events')) {
      data = { events: growingTailEvents };
    } else if (pathname.endsWith('/stream')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      });
      return;
    } else {
      await route.fulfill({ status: 404, body: 'not mocked' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data,
        meta: { request_id: 'req', schema_version: 1 },
      }),
    });
  });

  let growingTailStarted = false;
  const appendGrowingTailEvent = (text: string): void => {
    const eventId = String(growingSequence++);
    growingTailEvents.push({
      eventId,
      runtimeId: 'runtime-1',
      sequenceId: Number(eventId),
      createdAt: '2026-07-12T00:00:00Z',
      kind: 'assistant_text_delta',
      sessionId: 'session-1',
      nativeThreadId: 'thread-1',
      nativeTurnId: 'streaming-growth-turn',
      itemId: 'streaming-growth-tail',
      payload: {
        nativeMethod: 'item/agentMessage/delta',
        text,
      },
    });
  };
  const multiItemTurnSteps = [
    {
      itemId: 'multi-reasoning-a',
      kind: 'reasoning_delta',
      marker: 'Multi-item reasoning begins.',
      payload: {
        nativeMethod: 'item/reasoning/delta',
        text: `Multi-item reasoning begins.\n${'Expanded analysis line. '.repeat(
          80,
        )}`,
      },
    },
    {
      itemId: 'multi-command',
      kind: 'command_activity',
      marker: 'MULTI_ITEM_COMMAND_OUTPUT',
      payload: {
        nativeMethod: 'item/commandExecution/completed',
        command: 'pnpm test',
        output: `MULTI_ITEM_COMMAND_OUTPUT\n${'command output '.repeat(80)}`,
        status: 'completed',
      },
    },
    {
      itemId: 'multi-commentary',
      kind: 'assistant_text_delta',
      marker: 'Multi-item commentary update.',
      payload: {
        nativeMethod: 'item/agentMessage/delta',
        text: 'Multi-item commentary update.',
        messagePhase: 'commentary',
      },
    },
    {
      itemId: 'multi-reasoning-b',
      kind: 'reasoning_delta',
      marker: 'Second reasoning item.',
      payload: {
        nativeMethod: 'item/reasoning/delta',
        text: `Second reasoning item.\n${'More expanded analysis. '.repeat(60)}`,
      },
    },
    {
      itemId: 'multi-tool',
      kind: 'mcp_activity',
      marker: 'MULTI_ITEM_TOOL_RESULT',
      payload: {
        nativeMethod: 'item/mcpToolCall/completed',
        tool: 'den/get_task',
        text: 'MULTI_ITEM_TOOL_RESULT',
        status: 'completed',
      },
    },
    {
      itemId: 'multi-final',
      kind: 'assistant_text_delta',
      marker: 'Multi-item final answer.',
      payload: {
        nativeMethod: 'item/agentMessage/delta',
        text: 'Multi-item final answer.',
        messagePhase: 'final_answer',
      },
    },
  ] as const;
  const appendEvent = (
    kind: string,
    itemId: string | undefined,
    payload: Record<string, unknown>,
  ): void => {
    const eventId = String(growingSequence++);
    growingTailEvents.push({
      eventId,
      runtimeId: 'runtime-1',
      sequenceId: Number(eventId),
      createdAt: '2026-07-12T00:00:00Z',
      kind,
      sessionId: 'session-1',
      nativeThreadId: 'thread-1',
      nativeTurnId: 'multi-item-turn',
      ...(itemId === undefined ? {} : { itemId }),
      payload,
    });
  };
  return {
    startGrowingTail(): void {
      growingTailStarted = true;
      appendGrowingTailEvent('Streaming growth begins.');
    },
    growTail(text: string): void {
      if (!growingTailStarted) {
        throw new Error('startGrowingTail must be called before growTail');
      }
      appendGrowingTailEvent(text);
    },
    appendMultiItemTurnStep(step: number): string {
      const entry = multiItemTurnSteps[step];
      if (entry === undefined) {
        throw new Error(`Unknown multi-item turn step ${step}`);
      }
      appendEvent(entry.kind, entry.itemId, entry.payload);
      return entry.marker;
    },
    completeMultiItemTurn(): void {
      appendEvent('turn_lifecycle', undefined, {
        nativeMethod: 'turn/completed',
        status: 'completed',
      });
    },
  };
}

async function transcriptTailGapAfter(
  transcript: Locator,
  delayMs: number,
): Promise<number> {
  return transcript.evaluate(
    (viewport, delay) =>
      new Promise<number>((resolve) => {
        setTimeout(() => {
          const items = viewport.querySelectorAll<HTMLElement>(
            '.rv-transcript__item',
          );
          const lastItem = items.item(items.length - 1);
          resolve(
            lastItem === null
              ? Number.POSITIVE_INFINITY
              : viewport.getBoundingClientRect().bottom -
                  lastItem.getBoundingClientRect().bottom,
          );
        }, delay);
      }),
    delayMs,
  );
}

async function transcriptGeometryAfter(
  transcript: Locator,
  delayMs: number,
): Promise<{
  tailGap: number;
  bottomOffset: number;
  renderedEndMismatch: number;
  viewportCoverageGap: number;
}> {
  return transcript.evaluate(
    (viewport, delay) =>
      new Promise((resolve) => {
        setTimeout(() => {
          const content = viewport.querySelector<HTMLElement>(
            '.rv-transcript__owned-window-content',
          );
          const items = viewport.querySelectorAll<HTMLElement>(
            '.rv-transcript__item',
          );
          const lastItem = items.item(items.length - 1);
          if (content === null || lastItem === null) {
            resolve({
              tailGap: Number.POSITIVE_INFINITY,
              bottomOffset: Number.POSITIVE_INFINITY,
              renderedEndMismatch: Number.POSITIVE_INFINITY,
              viewportCoverageGap: Number.POSITIVE_INFINITY,
            });
            return;
          }

          const viewportBounds = viewport.getBoundingClientRect();
          const contentBounds = content.getBoundingClientRect();
          const lastBounds = lastItem.getBoundingClientRect();
          const renderedContentEnd =
            viewport.scrollTop + lastBounds.bottom - viewportBounds.top;
          resolve({
            tailGap: viewportBounds.bottom - lastBounds.bottom,
            bottomOffset:
              viewport.scrollHeight -
              viewport.scrollTop -
              viewport.clientHeight,
            renderedEndMismatch: renderedContentEnd - viewport.scrollHeight,
            viewportCoverageGap: Math.max(
              0,
              contentBounds.top - viewportBounds.top,
            ),
          });
        }, delay);
      }),
    delayMs,
  );
}
