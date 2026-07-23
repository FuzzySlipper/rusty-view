import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const live = process.env['RV_ACTIVITY_CENSUS_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('runtime activity census @live-activity', () => {
  test.skip(
    !live,
    'set RV_ACTIVITY_CENSUS_LIVE_RUN=1 for the real Crew activity census scenario',
  );

  test('renders native tool hierarchy, durable mismatch, and managed Codex activity', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(4 * 60_000);
    const sessionId = 'tester-session';
    const marker = `view-activity-${Date.now()}`;

    const sendAttempt = request
      .post(
        `${backend}/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          data: {
            actor: {
              id: 'task-6080-view-cert',
              kind: 'human',
              display_name: 'Task 6080 View Certificate',
            },
            body: [
              'Use the terminal tool exactly once to run this command:',
              'sleep 60',
              'After it completes, reply with exactly ACTIVITY_CENSUS_DONE.',
            ].join('\n'),
            client_message_id: marker,
            reason: 'task 6080 runtime activity browser certification',
          },
          headers: { 'Idempotency-Key': marker },
          timeout: 5_000,
        },
      )
      .catch(() => undefined);
    await expect
      .poll(
        async () =>
          activityKindsForSession(request, 'service', sessionId, marker),
        {
          timeout: 90_000,
          intervals: [250, 500, 1_000],
          message: 'real tester turn should reach its terminal subprocess',
        },
      )
      .toEqual(
        expect.arrayContaining([
          'dispatch',
          'wake',
          'provider_request',
          'tool_call',
          'subprocess',
        ]),
      );

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
    await page.locator('[data-menu-id="debug"]').click();
    const debugPanel = page.getByTestId('top-menu-panel-debug');
    await debugPanel.getByRole('button', { name: 'Active Agents' }).click();

    const activityPanel = page.getByTestId('runtime-activity-panel');
    await expect(activityPanel).toBeVisible();
    await expect(activityPanel.getByTestId('activity-freshness')).toHaveText(
      'Fresh',
      { timeout: 30_000 },
    );
    await expect(
      activityPanel.locator(
        `tr[data-status="active"][data-activity-kind="subprocess"]:has-text("${sessionId}")`,
      ),
    ).toBeVisible();
    for (const kind of [
      'dispatch',
      'wake',
      'provider_request',
      'tool_call',
      'subprocess',
    ]) {
      await expect(
        activityPanel.locator(
          `tr[data-status="active"][data-activity-kind="${kind}"]:has-text("${sessionId}")`,
        ),
      ).toBeVisible();
    }
    await expect(
      activityPanel
        .locator('tr[data-status="active"][data-activity-kind="external_turn"]')
        .first(),
      'the debug Crew service should expose at least one managed Codex turn',
    ).toBeVisible();

    await activityPanel
      .getByTestId('activity-projection-mode')
      .selectOption('durable');
    await expect(activityPanel).toContainText('showing durable projection', {
      timeout: 30_000,
    });
    await expect(
      activityPanel
        .locator('[data-code="session_projection_mismatch"]')
        .first(),
    ).toBeVisible();
    await expect(activityPanel).toContainText(
      'runtime activity is active while the session projection is idle',
    );

    await page.screenshot({
      path: testInfo.outputPath('runtime-activity-census-live.png'),
      fullPage: true,
    });

    await activityPanel
      .locator(
        `tr[data-status="active"][data-activity-kind="subprocess"]:has-text("${sessionId}")`,
      )
      .getByTestId('activity-session-controls')
      .click();
    const sessionsPanel = page.getByTestId('top-menu-panel-sessions');
    await expect(sessionsPanel).toBeVisible();
    await expect(
      sessionsPanel.getByTestId('session-control-target'),
    ).toHaveAttribute('data-session-id', sessionId);
    await expect(
      sessionsPanel.locator(
        `[data-testid="session-pause-runtime"][data-session-id="${sessionId}"]`,
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('runtime-activity-session-controls-live.png'),
      fullPage: true,
    });

    await sendAttempt;
  });
});

async function activityKindsForSession(
  request: APIRequestContext,
  projection: 'service' | 'durable',
  sessionId: string,
  marker: string,
): Promise<readonly string[]> {
  const response = await request.get(
    `${backend}/v1/admin/diagnostics/activities?sessionProjection=${projection}&probe=${Date.now()}`,
  );
  const responseText = await response.text();
  expect(response.status(), responseText).toBe(200);
  const body = asRecord(JSON.parse(responseText) as unknown);
  const data = asRecord(body['data']);
  const active = Array.isArray(data['active']) ? data['active'] : [];
  return active
    .map((entry) => asRecord(asRecord(entry)['activity']))
    .filter(
      (activity) =>
        activity['sessionId'] === sessionId ||
        String(activity['summary'] ?? '').includes(marker),
    )
    .map((activity) => String(activity['kind']));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
