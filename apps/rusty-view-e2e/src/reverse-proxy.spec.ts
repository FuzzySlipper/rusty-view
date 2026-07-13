import { expect, test, type Page, type Response } from '@playwright/test';

test('keeps initial Crew reads on the reverse-proxy origin @reverse-proxy-live', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env['RV_REVERSE_PROXY_RUN'] !== '1',
    'Set RV_REVERSE_PROXY_RUN=1 and BASE_URL to a deployed proxy origin.',
  );

  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const crewApiRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/v1/')) crewApiRequests.push(url.toString());
  });

  const sessionsRead = waitForApiRead(page, origin, '/v1/chat/sessions');
  const interactionsRead = waitForApiRead(
    page,
    origin,
    '/v1/external-interactions',
  );
  await page.goto(`${origin}/#reverse-proxy-certification`);

  await expectCrewEnvelope(await sessionsRead, 'items');
  await expectCrewEnvelope(await interactionsRead, 'interactions');
  await expect
    .poll(() =>
      page.evaluate(() => window.__RUSTY_VIEW_TEST__?.getBackendBaseUrl()),
    )
    .toBe(origin);

  expect(crewApiRequests.length).toBeGreaterThanOrEqual(2);
  expect(
    crewApiRequests.every(
      (requestUrl) => new URL(requestUrl).origin === origin,
    ),
  ).toBe(true);
  expect(
    crewApiRequests.filter((requestUrl) =>
      ['9347', '9348'].includes(new URL(requestUrl).port),
    ),
  ).toEqual([]);
});

function waitForApiRead(
  page: Page,
  origin: string,
  pathname: string,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === origin &&
      url.pathname === pathname &&
      response.request().method() === 'GET'
    );
  });
}

async function expectCrewEnvelope(
  response: Response,
  collectionKey: 'items' | 'interactions',
): Promise<void> {
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/json');
  const payload = (await response.json()) as {
    readonly ok?: unknown;
    readonly data?: Record<string, unknown>;
    readonly meta?: Record<string, unknown>;
  };
  expect(payload.ok).toBe(true);
  expect(payload.data?.[collectionKey]).toEqual(expect.any(Array));
  expect(payload.meta).toMatchObject({
    request_id: expect.any(String),
    schema_version: 1,
  });
}
