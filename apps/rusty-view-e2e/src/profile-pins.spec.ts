import { expect, test, type Page } from '@playwright/test';

test('profile pins persist, sort stably, and remain touch-friendly', async ({
  page,
}) => {
  const sessions = [
    session('newest-session', 'newest-profile', '2026-07-28T03:00:00Z'),
    session('middle-session', 'middle-profile', '2026-07-28T02:00:00Z'),
    session('oldest-session', 'oldest-profile', '2026-07-28T01:00:00Z'),
  ];
  let openedSessionCount = 0;

  await page.route('http://crew.test/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const ok = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data,
          meta: { request_id: 'profile-pins', schema_version: 1 },
        }),
      });

    if (pathname === '/v1/chat/sessions') {
      return ok({
        items: sessions,
        total: sessions.length,
        limit: 100,
        offset: 0,
      });
    }
    if (pathname === '/v1/coordination/agents') {
      return ok({
        deploymentRole: 'production',
        agents: sessions.map((item) => ({
          agentId: item.agent_id,
          displayLabel: item.profile_id,
          profileId: item.profile_id,
          routable: true,
          runtimeKind: 'direct_brain',
          sessionId: item.session_id,
          sessionKind: item.kind,
          sessionStatus: item.status,
          workdir: `/home/dev/${item.profile_id}`,
        })),
      });
    }
    if (pathname === '/v1/chat/commands') return ok({ commands: [] });
    if (pathname.startsWith('/v1/chat/sessions/')) {
      openedSessionCount += 1;
      const item =
        sessions.find((candidate) => pathname.includes(candidate.session_id)) ??
        sessions[0];
      return ok({
        session: item,
        events: [],
        latest_cursor: '',
        has_more_before: false,
      });
    }
    if (pathname === '/v1/external-runtimes') {
      return ok({ runtimes: [], controllers: [] });
    }
    if (pathname === '/v1/external-bindings') return ok({ bindings: [] });
    if (pathname === '/v1/external-interactions') {
      return ok({ interactions: [] });
    }

    return route.fulfill({ status: 404, body: 'not mocked' });
  });

  await page.goto('/?api=http://crew.test');
  await expect(profileRows(page)).toHaveCount(3);
  await expect
    .poll(() => profileOrder(page))
    .toEqual(['newest-profile', 'middle-profile', 'oldest-profile']);

  const oldestGroup = page
    .locator('.rv-profile-group')
    .filter({ has: page.locator('[data-profile-id="oldest-profile"]') });
  const pin = oldestGroup.getByTestId('profile-pin');
  await expect(pin).toHaveAttribute('aria-label', 'Pin oldest-profile');
  await pin.click();

  expect(openedSessionCount).toBe(0);
  await expect
    .poll(() => profileOrder(page))
    .toEqual(['oldest-profile', 'newest-profile', 'middle-profile']);
  await expect(pin).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect
    .poll(() => profileOrder(page))
    .toEqual(['oldest-profile', 'newest-profile', 'middle-profile']);
  const restoredPin = page
    .locator('.rv-profile-group')
    .filter({ has: page.locator('[data-profile-id="oldest-profile"]') })
    .getByTestId('profile-pin');
  await expect(restoredPin).toHaveAttribute('aria-pressed', 'true');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileToggle = page.getByTestId('mobile-sessions-toggle');
  await expect(mobileToggle).toBeVisible();
  await mobileToggle.click();
  await expect(page.locator('.rv-debug__sidebar')).toBeVisible();
  await expect(restoredPin).toBeVisible();
  const touchTarget = await restoredPin.boundingBox();
  expect(touchTarget?.width).toBeGreaterThanOrEqual(44);
  expect(touchTarget?.height).toBeGreaterThanOrEqual(44);
});

function session(sessionId: string, profileId: string, updatedAt: string) {
  return {
    session_id: sessionId,
    agent_id: profileId,
    profile_id: profileId,
    kind: 'full',
    status: 'idle',
    latest_cursor: '',
    updated_at: updatedAt,
  };
}

function profileRows(page: Page) {
  return page.getByTestId('profile-row');
}

async function profileOrder(page: Page): Promise<string[]> {
  return profileRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-profile-id') ?? ''),
  );
}
