import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { chromium, expect, test, type Route } from '@playwright/test';

const execFileAsync = promisify(execFile);

test('advertises an installable same-origin standalone web app without offline caching', async ({
  browserName,
  context,
  page,
  request,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium exposes installability CDP.');
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    'manifest.json',
  );

  const response = await request.get('/manifest.json');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/json');
  const manifest = (await response.json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    id: '/',
    name: 'Rusty View',
    start_url: './',
    scope: './',
    display: 'standalone',
  });
  expect(manifest['icons']).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: 'rusty-view-icon.svg',
        type: 'image/svg+xml',
      }),
    ]),
  );

  expect(
    await page.evaluate(async () =>
      navigator.serviceWorker?.getRegistrations(),
    ),
  ).toEqual([]);

  const pageSession = await context.newCDPSession(page);
  const appManifest = await pageSession.send('Page.getAppManifest');
  expect(appManifest.errors).toEqual([]);
  expect(appManifest.manifest).toMatchObject({
    id: `${new URL(page.url()).origin}/`,
    name: 'Rusty View',
    display: 'kStandalone',
  });
  const installability = await pageSession.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  await pageSession.detach();
});

test('installs, launches, and refreshes the Crew-backed standalone app @pwa-install-live', async (_fixtures, testInfo) => {
  test.skip(
    process.env['RV_PWA_INSTALL_RUN'] !== '1',
    'Set RV_PWA_INSTALL_RUN=1 and run headed under Xvfb for native install proof.',
  );

  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const profileDirectory = testInfo.outputPath('chromium-profile');
  const confirmDialog = testInfo.outputPath('x11-confirm-dialog');
  const confirmDialogSource = resolve(
    process.cwd(),
    'apps/rusty-view-e2e/src/support/x11-confirm-dialog.c',
  );
  await execFileAsync('cc', [
    confirmDialogSource,
    '-O2',
    '-lX11',
    '-lXtst',
    '-o',
    confirmDialog,
  ]);

  const context = await chromium.launchPersistentContext(profileDirectory, {
    headless: false,
    args: ['--enable-features=WebAppInstallation'],
  });
  const crewRequests: string[] = [];
  try {
    await context.route(`${origin}/v1/**`, async (route) => {
      crewRequests.push(new URL(route.request().url()).pathname);
      const pathname = new URL(route.request().url()).pathname;
      const data =
        pathname === '/v1/chat/commands'
          ? { commands: [] }
          : { items: [], total: 0, limit: 100, offset: 0 };
      await fulfillJson(route, data);
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(
      `${origin}/?api=${encodeURIComponent(origin)}#standalone-certification`,
    );
    await expect
      .poll(() => page.evaluate(() => typeof navigator.install))
      .toBe('function');

    await page.evaluate(() => {
      const installNavigator = navigator as Navigator & {
        install(): Promise<{ readonly manifestId: string }>;
      };
      const stateWindow = window as Window & {
        __RV_PWA_INSTALL_RESULT__?:
          | { readonly status: 'pending' }
          | { readonly status: 'installed'; readonly manifestId: string }
          | { readonly status: 'failed'; readonly message: string };
      };
      stateWindow.__RV_PWA_INSTALL_RESULT__ = { status: 'pending' };
      void installNavigator.install().then(
        (result) => {
          stateWindow.__RV_PWA_INSTALL_RESULT__ = {
            status: 'installed',
            manifestId: result.manifestId,
          };
        },
        (error: unknown) => {
          stateWindow.__RV_PWA_INSTALL_RESULT__ = {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          };
        },
      );
    });
    await page.waitForTimeout(750);
    await execFileAsync(confirmDialog);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const stateWindow = window as Window & {
            __RV_PWA_INSTALL_RESULT__?: { readonly status: string };
          };
          return stateWindow.__RV_PWA_INSTALL_RESULT__?.status;
        }),
      )
      .toBe('installed');
    await expect
      .poll(() =>
        page.evaluate(() => matchMedia('(display-mode: standalone)').matches),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.__RUSTY_VIEW_TEST__?.getBackendBaseUrl()),
      )
      .toBe(origin);
    await expect.poll(() => crewRequests).toContain('/v1/chat/sessions');

    crewRequests.length = 0;
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => matchMedia('(display-mode: standalone)').matches),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.__RUSTY_VIEW_TEST__?.getBackendBaseUrl()),
      )
      .toBe(origin);
    await expect.poll(() => crewRequests).toContain('/v1/chat/sessions');

    const screenshot = testInfo.outputPath('standalone-launch.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('standalone-launch', {
      path: screenshot,
      contentType: 'image/png',
    });
  } finally {
    await context.close();
  }
});

function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      data,
      meta: { request_id: 'req_pwa', schema_version: 1 },
    }),
  });
}
