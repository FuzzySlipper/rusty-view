import { expect, test } from '@playwright/test';

test('advertises a same-origin standalone web app without offline caching', async ({
  page,
  request,
}) => {
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
});
