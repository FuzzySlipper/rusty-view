import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const live = process.env['RV_PROFILE_SOUL_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

test.describe('profile create soul persistence @live-agent @profiles', () => {
  test.skip(
    !live,
    'set RV_PROFILE_SOUL_LIVE_RUN=1 for the real Crew profile soul scenario',
  );

  test('persists soul markdown and injects it into a new Codex session', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(8 * 60_000);
    page.setDefaultTimeout(30_000);
    const suffix = Date.now();
    const profileId = `rv-soul-cert-${suffix}`;
    const marker = `RV_SOUL_MARKER_${suffix}`;
    const sessionLabel = `Soul certification ${suffix}`;
    const soulMarkdown = [
      '# Rusty View profile soul certification',
      `The private profile marker is ${marker}.`,
      'When asked for the private profile marker, reply with only that marker.',
    ].join('\n');
    let target: LiveExternalTarget | undefined;
    let profileCreated = false;
    let createWrite: Record<string, unknown> | undefined;

    try {
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/v1/admin/control/profiles'
        ) {
          createWrite = request.postDataJSON() as Record<string, unknown>;
        }
      });
      await page.goto(`/?api=${encodeURIComponent(backend)}`);
      await openProfilesPanel(page);
      await page.getByRole('button', { name: 'Create Profile' }).click();
      const createDialog = page.getByRole('dialog', {
        name: 'Create Profile',
      });
      await createDialog.getByLabel('Profile ID').fill(profileId);
      await createDialog.getByLabel('Display Name').fill(sessionLabel);
      await createDialog.getByLabel('Session kind').selectOption('full');
      await createDialog
        .getByLabel('Provider alias')
        .selectOption('tester-chat');
      await createDialog.getByLabel('soul.md (optional)').fill(soulMarkdown);
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/v1/admin/control/profiles',
      );
      await createDialog
        .getByRole('button', { name: 'Create Profile', exact: true })
        .click();
      expect((await createResponsePromise).ok()).toBe(true);
      profileCreated = true;
      expect(createWrite).toMatchObject({
        profileId,
        displayName: sessionLabel,
        kind: 'full',
        providerAlias: 'tester-chat',
        soulMarkdown,
      });

      const createdRecord = await registryRecord(request, profileId);
      expect(createdRecord['promptSoulMarkdown']).toBe(soulMarkdown);
      expect(String(createdRecord['promptSoulMarkdown'])).toContain(marker);

      await expect(profileRegistryRow(page, profileId)).toBeVisible({
        timeout: 30_000,
      });
      await page
        .getByTestId('top-menu-panel-profiles')
        .getByRole('button', { name: 'Close profiles' })
        .click();
      await page.getByTestId('external-agents-tab').click();
      await page.getByTestId('external-agent-create').click();
      await page.getByLabel('Codex session profile').selectOption(profileId);
      await page
        .getByPlaceholder('/home/dev/project')
        .fill('/home/dev/rusty-view');
      await page.getByPlaceholder('Optional session name').fill(sessionLabel);
      await page.getByTestId('external-agent-create-submit').click();

      const sessionRow = page
        .getByTestId('external-agent-row')
        .filter({ hasText: sessionLabel });
      await expect(sessionRow).toBeVisible({ timeout: 45_000 });
      const threadId = await sessionRow.evaluate((element) =>
        element.getAttribute('data-thread-id'),
      );
      expect(threadId).toBeTruthy();
      target = await bindingForThread(request, threadId ?? '');

      const composer = page.getByTestId('message-input-field');
      await expect(composer).toBeEnabled();
      await composer.fill(
        'What is the private profile marker? Reply with only it.',
      );
      await page.getByTestId('send-message').click();
      await Promise.all([
        expect(page.getByTestId('transcript-shell')).toContainText(marker, {
          timeout: 2 * 60_000,
        }),
        expect(page.getByTestId('external-turn-status')).toHaveAttribute(
          'data-turn-phase',
          'completed',
          { timeout: 2 * 60_000 },
        ),
      ]);

      await page.reload();
      await openProfilesPanel(page);
      const reloadedRow = profileRegistryRow(page, profileId);
      await expect(reloadedRow).toBeVisible({ timeout: 30_000 });
      await reloadedRow.getByRole('button', { name: 'Edit' }).click();
      const editDialog = page.getByRole('dialog', { name: 'Edit Profile' });
      await expect(editDialog).toContainText(`Edit Profile — ${profileId}`);
      await editDialog.getByRole('button', { name: 'Prompts' }).click();
      await expect(editDialog.locator('textarea').first()).toHaveValue(
        soulMarkdown,
      );
      await testInfo.attach('profile-soul-certification.json', {
        body: JSON.stringify(
          {
            profileId,
            marker,
            soulMarkdown,
            createWrite,
            registryRecord: createdRecord,
            runtimeId: target.runtimeId,
            bindingId: target.bindingId,
            threadId: target.threadId,
            reloadReadback: soulMarkdown,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      if (target !== undefined) await deleteThread(request, target);
      if (profileCreated) await deleteProfile(request, profileId);
    }
  });
});

async function openProfilesPanel(page: Page): Promise<void> {
  await page.locator('[data-menu-id="profiles"]').click();
  await expect(page.getByTestId('top-menu-panel-profiles')).toBeVisible();
}

function profileRegistryRow(page: Page, profileId: string) {
  return page
    .locator('li.rv-admin-profiles__registry')
    .filter({ hasText: profileId });
}

async function registryRecord(
  request: APIRequestContext,
  profileId: string,
): Promise<Record<string, unknown>> {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${backend}/v1/admin/profiles/registry?limit=100&offset=0`,
        );
        expect(response.ok()).toBe(true);
        const data = asRecord(asRecord(await response.json())['data']);
        const items = data['items'];
        if (!Array.isArray(items)) return undefined;
        return items.some((item) => asRecord(item)['profileId'] === profileId);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const response = await request.get(
    `${backend}/v1/admin/profiles/registry?limit=100&offset=0`,
  );
  const items = asRecord(asRecord(await response.json())['data'])['items'];
  if (!Array.isArray(items)) throw new Error('registry items missing');
  const record = items
    .map(asRecord)
    .find((candidate) => candidate['profileId'] === profileId);
  if (record === undefined) throw new Error(`profile ${profileId} missing`);
  return record;
}

interface LiveExternalTarget {
  readonly runtimeId: string;
  readonly bindingId: string;
  readonly threadId: string;
}

async function bindingForThread(
  request: APIRequestContext,
  threadId: string,
): Promise<LiveExternalTarget> {
  const response = await request.get(`${backend}/v1/external-bindings`);
  expect(response.ok()).toBe(true);
  const bindings = asRecord(asRecord(await response.json())['data'])[
    'bindings'
  ];
  if (!Array.isArray(bindings)) throw new Error('bindings response is missing');
  const binding = bindings
    .map(asRecord)
    .find((candidate) => candidate['nativeThreadId'] === threadId);
  if (binding === undefined) throw new Error(`binding missing for ${threadId}`);
  return {
    runtimeId: String(binding['runtimeId']),
    bindingId: String(binding['bindingId']),
    threadId,
  };
}

async function deleteThread(
  request: APIRequestContext,
  target: LiveExternalTarget,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.post(
          `${backend}/v1/external-runtimes/${encodeURIComponent(target.runtimeId)}/threads/${encodeURIComponent(target.threadId)}/delete`,
        );
        return response.status();
      },
      { timeout: 60_000 },
    )
    .toBe(200);
}

async function deleteProfile(
  request: APIRequestContext,
  profileId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.post(
          `${backend}/v1/admin/control/profiles/${encodeURIComponent(profileId)}/delete`,
          {
            data: {
              reason: 'Rusty View soul persistence certification cleanup',
              confirmProfileId: profileId,
            },
          },
        );
        return response.status();
      },
      { timeout: 60_000 },
    )
    .toBe(200);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
