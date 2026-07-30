import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const live = process.env['RV_SESSION_EXECUTION_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const provider = process.env['RV_LIVE_PROVIDER_ALIAS'] ?? 'tester-chat';
const workingPhase = /^(queued|active|waiting|paused|cancelling)$/;

test.describe('native Crew session execution status @live-agent', () => {
  test.skip(
    !live,
    'set RV_SESSION_EXECUTION_LIVE_RUN=1 for the real Crew debug scenario',
  );

  test('updates selected and background native rows without manual refresh', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const suffix = Date.now().toString(36);
    const selectedProfile = `rv-status-selected-${suffix}`;
    const backgroundProfile = `rv-status-background-${suffix}`;
    const createdProfiles: string[] = [];

    try {
      const selectedSession = await createProfile(
        request,
        selectedProfile,
        createdProfiles,
      );
      const backgroundSession = await createProfile(
        request,
        backgroundProfile,
        createdProfiles,
      );

      await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
      const selectedRow = page.locator(
        `[data-testid="profile-session-row"][data-session-id="${selectedSession}"]`,
      );
      const backgroundRow = page.locator(
        `[data-testid="profile-session-row"][data-session-id="${backgroundSession}"]`,
      );
      await expect(selectedRow).toBeVisible({ timeout: 30_000 });
      await expect(backgroundRow).toBeVisible({ timeout: 30_000 });
      await selectedRow.click();
      await expect(page.getByTestId('native-execution-status')).toHaveAttribute(
        'data-execution-phase',
        'idle',
      );

      const selectedSend = runSleepingTurn(
        request,
        selectedSession,
        `SELECTED_${suffix.toUpperCase()}`,
      );
      const backgroundSend = runSleepingTurn(
        request,
        backgroundSession,
        `BACKGROUND_${suffix.toUpperCase()}`,
      );

      await expect(selectedRow).toHaveAttribute(
        'data-session-status',
        workingPhase,
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('native-execution-status')).toHaveAttribute(
        'data-execution-phase',
        workingPhase,
        { timeout: 30_000 },
      );
      await expect(backgroundRow).toHaveAttribute(
        'data-session-status',
        workingPhase,
        { timeout: 30_000 },
      );
      await page.screenshot({
        path: testInfo.outputPath('01-selected-and-background-working.png'),
        fullPage: true,
      });

      const [selectedResponse, backgroundResponse] = await Promise.all([
        selectedSend,
        backgroundSend,
      ]);
      expect(selectedResponse.status()).toBe(202);
      expect(backgroundResponse.status()).toBe(202);

      await expect(selectedRow).toHaveAttribute(
        'data-session-status',
        'completed',
        { timeout: 30_000 },
      );
      await expect(backgroundRow).toHaveAttribute(
        'data-session-status',
        'completed',
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('native-execution-status')).toHaveAttribute(
        'data-execution-phase',
        'idle',
      );
      await expect(page.getByTestId('native-execution-status')).toHaveAttribute(
        'data-execution-outcome',
        'completed',
      );
      await page.screenshot({
        path: testInfo.outputPath('02-selected-and-background-completed.png'),
        fullPage: true,
      });
    } finally {
      for (const profileId of createdProfiles.reverse()) {
        await deleteProfile(request, profileId);
      }
    }
  });
});

async function createProfile(
  request: APIRequestContext,
  profileId: string,
  createdProfiles: string[],
): Promise<string> {
  const response = await request.post(`${backend}/v1/admin/control/profiles`, {
    data: {
      profileId,
      displayName: `Rusty View status ${profileId}`,
      providerAlias: provider,
      kind: 'full',
      localToolProfileId: 'full_coding_agent',
      reason: 'task-6421 native execution status live certification',
    },
  });
  expect(response.status()).toBe(200);
  createdProfiles.push(profileId);
  const body = await response.json();
  const sessionId = nested(body, ['data', 'outcome', 'result', 'sessionId']);
  expect(typeof sessionId).toBe('string');
  expect(sessionId).not.toBe('');
  return sessionId as string;
}

function runSleepingTurn(
  request: APIRequestContext,
  sessionId: string,
  marker: string,
) {
  const key = `task-6421-${sessionId}-${Date.now()}`;
  return request.post(
    `${backend}/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      headers: { 'Idempotency-Key': key },
      data: {
        actor: { id: 'task-6421-cert-operator', kind: 'human' },
        body: `Use the terminal tool exactly once to run sleep 8. After it finishes, reply with exactly ${marker}.`,
        client_message_id: key,
        reason: 'task-6421 selected and background live status proof',
      },
      timeout: 180_000,
    },
  );
}

async function deleteProfile(
  request: APIRequestContext,
  profileId: string,
): Promise<void> {
  const response = await request.post(
    `${backend}/v1/admin/control/profiles/${encodeURIComponent(profileId)}/delete`,
    {
      data: {
        confirmProfileId: profileId,
        reason: 'task-6421 live certification cleanup',
      },
    },
  );
  expect(response.status()).toBeLessThan(400);
}

function nested(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
