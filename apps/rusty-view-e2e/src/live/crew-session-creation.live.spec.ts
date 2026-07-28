import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const live = process.env['RV_CREW_SESSION_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const provider = process.env['RV_LIVE_PROVIDER_ALIAS'] ?? 'tester-chat';
const providerTurn =
  process.env['RV_CREW_SESSION_PROVIDER_TURN']?.trim() !== '0';
const marker = `CREW_SESSION_CREATE_6327_${Date.now()}`;

test.describe('Crew brain session creation and archive @live-agent', () => {
  test.skip(
    !live,
    'set RV_CREW_SESSION_LIVE_RUN=1 for the real Crew debug scenario',
  );

  test('creates, uses, archives, and finds a real Crew session in history', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const profile = `rv-crew-create-6327-${Date.now()}`;
    const fallbackProfile = `${profile}-fallback`;
    let profileCreated = false;
    let fallbackProfileCreated = false;
    let creationBody: unknown;
    let creationKey: string | null = null;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/v1/chat/sessions'
      ) {
        creationBody = request.postDataJSON();
        creationKey = request.headers()['idempotency-key'] ?? null;
      }
    });

    try {
      await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
      await page.locator('[data-menu-id="profiles"]').click();
      await createProfile(page, profile, 'Crew create 6327');
      profileCreated = true;
      await createProfile(page, fallbackProfile, 'Crew fallback 6327');
      fallbackProfileCreated = true;
      await activeSessionForProfile(request, fallbackProfile);

      // Profile creation supplies a real provider-backed brain and template
      // session. Archive that template so the fresh-session API can prove its
      // intended no-active-session precondition without touching shared data.
      const templateSessionId = await activeSessionForProfile(request, profile);
      await archiveSession(request, templateSessionId, 'template');
      await page
        .getByTestId('top-menu-panel-profiles')
        .getByRole('button', { name: 'Close profiles' })
        .click();

      await expect(page.getByTestId('profile-new-session')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId('profile-new-session').click();
      await expect(page.getByTestId('agent-create-mode-crew')).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 30_000 },
      );
      await page.getByLabel('Agent session profile').selectOption(profile);
      await expect(page.getByPlaceholder('/home/dev/project')).toHaveCount(0);
      await expect(page.getByPlaceholder('Optional session name')).toHaveCount(
        0,
      );
      await page.screenshot({
        path: testInfo.outputPath('01-crew-create-form.png'),
        fullPage: true,
      });

      await page.getByTestId('external-agent-create-submit').click();
      await expect(page.getByTestId('crew-agents-tab')).toHaveClass(/active/, {
        timeout: 30_000,
      });
      const created = page.locator(
        '[data-testid="profile-session-row"].rv-profile-session--selected',
      );
      await expect(page.getByTestId('session-status-bar')).toHaveAttribute(
        'data-surface',
        'profile',
        { timeout: 30_000 },
      );
      await expect(created).toHaveAttribute('data-session-id', /\S+/);
      const sessionId = await created.evaluate(
        (element) => (element as HTMLElement).dataset['sessionId'] ?? '',
      );
      expect(sessionId).toBeTruthy();
      expect(creationBody).toEqual({
        profile_id: profile,
        expected_profile_revision: expect.any(Number),
      });
      expect(creationKey).toBeTruthy();

      if (providerTurn) {
        await page
          .getByTestId('message-input-field')
          .fill(`Reply with exactly ${marker} and nothing else.`);
        await page.getByTestId('send-message').click();
        await expect(
          page
            .locator('[data-message-role="assistant"]')
            .filter({ hasText: marker })
            .last(),
        ).toBeVisible({ timeout: 7 * 60_000 });
      }
      await page.screenshot({
        path: testInfo.outputPath(
          providerTurn
            ? '02-crew-provider-turn.png'
            : '02-crew-created-navigation-only.png',
        ),
        fullPage: true,
      });

      await page.getByTestId('message-input-field').fill('/archive');
      await page.getByTestId('send-message').click();
      await expect(
        page.locator(
          `[data-testid="profile-session-row"][data-session-id="${sessionId}"]`,
        ),
      ).toHaveCount(0, { timeout: 30_000 });
      const fallback = page.locator(
        '[data-testid="profile-session-row"].rv-profile-session--selected',
      );
      await expect(fallback).toHaveAttribute('data-session-id', /\S+/, {
        timeout: 30_000,
      });
      await expect(fallback).not.toHaveAttribute('data-session-id', sessionId);
      await expect(page.getByTestId('historical-session-banner')).toHaveCount(
        0,
      );

      await page.locator('.rv-top-menu__item', { hasText: 'Sessions' }).click();
      await page.getByTestId('sessions-filter-archived').click();
      const archivedRow = page.locator(
        `[data-testid="session-row"][data-session-id="${sessionId}"]`,
      );
      await expect(archivedRow).toBeVisible();
      await archivedRow.dispatchEvent('click');
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const api = (
                window as unknown as {
                  __RUSTY_VIEW_TEST__?: {
                    getActiveSessionId(): string | null;
                  };
                }
              ).__RUSTY_VIEW_TEST__;
              return api?.getActiveSessionId() ?? null;
            }),
          { timeout: 30_000 },
        )
        .toBe(sessionId);
      await expect(page.getByTestId('historical-session-banner')).toBeVisible({
        timeout: 30_000,
      });
      if (providerTurn) {
        await expect(
          page
            .locator('[data-message-role="assistant"]')
            .filter({ hasText: marker })
            .last(),
        ).toBeVisible();
      }
      await page.screenshot({
        path: testInfo.outputPath('03-crew-archived-history.png'),
        fullPage: true,
      });
    } finally {
      if (fallbackProfileCreated) {
        await archiveLiveSessionsForProfile(request, fallbackProfile);
        await deleteProfile(request, fallbackProfile);
      }
      if (profileCreated) {
        await archiveLiveSessionsForProfile(request, profile);
        await deleteProfile(request, profile);
      }
    }
  });
});

async function createProfile(
  page: Page,
  profileId: string,
  displayName: string,
): Promise<void> {
  await page
    .locator('button.rv-admin-profiles__button--primary')
    .first()
    .click();
  const profileDialog = page.getByRole('dialog', {
    name: 'Create Profile',
  });
  await profileDialog.getByLabel('Profile ID').fill(profileId);
  await profileDialog.getByLabel('Display Name').fill(displayName);
  await profileDialog.getByLabel('Session kind').selectOption('full');
  await profileDialog.getByLabel('Provider alias').selectOption(provider);
  await profileDialog
    .getByRole('button', { name: 'Create Profile', exact: true })
    .click();
  await expect(profileDialog).toHaveCount(0, { timeout: 30_000 });
}

async function activeSessionForProfile(
  request: APIRequestContext,
  profileId: string,
): Promise<string> {
  let sessionId = '';
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${backend}/v1/chat/sessions?profile_id=${encodeURIComponent(profileId)}&limit=100`,
        );
        const items = asRecord(asRecord(await response.json())['data'])[
          'items'
        ];
        if (!Array.isArray(items)) return false;
        const active = items
          .map(asRecord)
          .find((item) => item['status'] !== 'archived');
        sessionId =
          typeof active?.['session_id'] === 'string'
            ? active['session_id']
            : '';
        return sessionId !== '';
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return sessionId;
}

async function archiveSession(
  request: APIRequestContext,
  sessionId: string,
  suffix: string,
): Promise<void> {
  const response = await request.post(
    `${backend}/v1/chat/sessions/${encodeURIComponent(sessionId)}/commands`,
    {
      headers: { 'Idempotency-Key': `rv-6327-${suffix}-${Date.now()}` },
      data: { command: '/archive' },
    },
  );
  expect(response.ok()).toBe(true);
}

async function archiveLiveSessionsForProfile(
  request: APIRequestContext,
  profileId: string,
): Promise<void> {
  const response = await request.get(
    `${backend}/v1/chat/sessions?profile_id=${encodeURIComponent(profileId)}&limit=100`,
  );
  expect(response.ok()).toBe(true);
  const items = asRecord(asRecord(await response.json())['data'])['items'];
  if (!Array.isArray(items)) return;
  for (const [index, item] of items.map(asRecord).entries()) {
    if (item['status'] === 'archived') continue;
    const sessionId = item['session_id'];
    if (typeof sessionId !== 'string' || sessionId === '') continue;
    await archiveSession(request, sessionId, `cleanup-${index}`);
  }
}

async function deleteProfile(
  request: APIRequestContext,
  profileId: string,
): Promise<void> {
  const response = await request.post(
    `${backend}/v1/admin/control/profiles/${encodeURIComponent(profileId)}/delete`,
    {
      data: {
        reason: 'Rusty View task 6327 live certification cleanup',
        confirmProfileId: profileId,
      },
    },
  );
  expect(response.ok()).toBe(true);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
