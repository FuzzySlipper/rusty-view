import { expect, test } from '@playwright/test';

/**
 * Appearance → transcript reach smoke test (task #3288).
 *
 * Proves that changing a visual setting in Options → Appearance actually
 * reaches the rendered chat text (not just the document-root token). This was
 * broken because markdown-rendered assistant blocks used an unstyled
 * `.rv-block__markdown` container; this spec guards against regression.
 *
 * Requires a backend with at least one session (so a transcript is rendered).
 * Skips otherwise, like the other backend-dependent specs.
 */

test('appearance font-scale change reaches rendered transcript text', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.rv-debug__header')).toBeVisible({
    timeout: 10_000,
  });

  // Need a session to render transcript text.
  const hasSessions = await page
    .locator('.rv-session')
    .count()
    .then((c) => c > 0);
  test.skip(!hasSessions, 'no sessions available — needs a backend');

  await page.locator('.rv-session').first().click();
  await expect(page.locator('rv-transcript-viewport')).toBeVisible({
    timeout: 10_000,
  });

  // Helper: read the computed font-size of the first rendered chat text element.
  async function chatTextFontSize(): Promise<string> {
    return page.evaluate(() => {
      const el =
        document.querySelector('.rv-block__markdown') ??
        document.querySelector('.rv-block__content');
      return el !== null ? getComputedStyle(el).fontSize : '';
    });
  }

  // It may take a moment for the transcript to populate.
  await expect.poll(chatTextFontSize, { timeout: 10_000 }).not.toBe('');

  const before = await chatTextFontSize();

  // Open Options → crank the font scale slider to max.
  await page.locator('.rv-top-menu__item', { hasText: 'Options' }).click();
  await expect(page.locator('rv-appearance-tab')).toBeVisible();
  await page.locator('.rv-appearance__range').fill('1.5');
  await page.locator('.rv-options__close').click();

  // The rendered chat text must grow with the token change (13px → 20px at 1.5×).
  await expect.poll(chatTextFontSize, { timeout: 5_000 }).not.toBe(before);
  expect(
    parseInt((await chatTextFontSize()) ?? '0', 10),
  ).toBeGreaterThanOrEqual(19);
});
