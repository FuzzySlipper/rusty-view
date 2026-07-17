import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

const live = process.env['RV_PROVIDER_OAUTH_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';

interface ProviderRecord {
  alias: string;
  protocol: 'responses' | 'chat_completions';
  providerKind: string;
  credentialId?: string;
  credential: { hasSecret: boolean; kind?: string; status?: string };
}

interface CredentialRecord {
  credentialId: string;
  displayName: string;
  providerKind: string;
  credentialKind: string;
  credential: { hasSecret: boolean; kind?: string; status?: string };
  linkedProviderAliases: string[];
  revision: number;
}

test.describe('shared provider credential @live-provider', () => {
  test.skip(
    !live,
    'set RV_PROVIDER_OAUTH_LIVE_RUN=1 for the real Crew debug provider scenario',
  );

  test('links one configured OAuth credential to two aliases in the real browser UI', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(2 * 60_000);
    const scenario = await sharedCredentialScenario(request);
    let linkedByTest = false;
    try {
      await page.goto(`${backend}/?api=${encodeURIComponent(backend)}`);
      await page.locator('[data-menu-id="providers"]').click();
      const panel = page.getByTestId('top-menu-panel-providers');
      await expect(panel).toBeVisible();

      const candidateRow = panel
        .locator('.rv-admin-providers__provider')
        .filter({
          has: page.locator(
            '.rv-admin-providers__provider-header > span:first-child',
            { hasText: scenario.candidate.alias },
          ),
        });
      await expect(candidateRow).toContainText('no shared credential', {
        timeout: 30_000,
      });
      await candidateRow.getByRole('button', { name: 'Edit' }).click();

      const selector = panel.getByTestId('provider-credential-selector');
      await expect(
        selector.locator(
          `option[value="reuse:${scenario.credential.credentialId}"]`,
        ),
      ).toContainText(scenario.credential.displayName);
      await selector.selectOption(`reuse:${scenario.credential.credentialId}`);
      await panel.getByRole('button', { name: 'Update Provider' }).click();
      linkedByTest = true;

      const impact = panel.getByTestId('credential-impact');
      await expect(impact).toContainText(scenario.primary.alias, {
        timeout: 30_000,
      });
      await expect(impact).toContainText(scenario.candidate.alias);
      await expect(impact).toContainText('2 linked aliases');
      await expect(impact).toContainText('configured');

      const browserReadback = await readProvidersInBrowser(page, [
        scenario.primary.alias,
        scenario.candidate.alias,
      ]);
      expect(browserReadback).toEqual([
        {
          alias: scenario.primary.alias,
          credentialId: scenario.credential.credentialId,
          hasSecret: true,
        },
        {
          alias: scenario.candidate.alias,
          credentialId: scenario.credential.credentialId,
          hasSecret: true,
        },
      ]);

      await page.screenshot({
        path: testInfo.outputPath('provider-shared-credential.png'),
        fullPage: true,
      });

      await panel.getByRole('button', { name: 'Unlink from Provider' }).click();
      linkedByTest = false;
      await expect(impact).toContainText('1 linked aliases');
      await expect(impact).toContainText(scenario.primary.alias);
      await expect(selector).toHaveValue('unconfigured');
    } finally {
      if (linkedByTest) {
        await unlinkProviderCredential(request, scenario.candidate.alias);
      }
    }
  });
});

async function sharedCredentialScenario(request: APIRequestContext) {
  const credentials = await apiData<{ items: CredentialRecord[] }>(
    request,
    '/v1/admin/service-credentials?providerKind=openai&limit=100',
  );
  const credential = credentials.items.find(
    (candidate) =>
      candidate.credentialKind === 'openai_oauth' &&
      candidate.credential.hasSecret &&
      candidate.linkedProviderAliases.length === 1,
  );
  expect(
    credential,
    'a configured OAuth credential linked to exactly one debug alias',
  ).toBeDefined();
  if (credential === undefined) throw new Error('no shared OAuth credential');

  const providers = await apiData<{ items: ProviderRecord[] }>(
    request,
    '/v1/admin/model-providers?limit=100&offset=0',
  );
  const primary = providers.items.find(
    (provider) => provider.credentialId === credential.credentialId,
  );
  const candidate = providers.items.find(
    (provider) =>
      provider.alias !== primary?.alias &&
      provider.providerKind === credential.providerKind &&
      provider.protocol === 'responses' &&
      provider.credentialId === undefined,
  );
  expect(primary, 'the credential primary alias').toBeDefined();
  expect(candidate, 'an unlinked compatible Responses alias').toBeDefined();
  if (primary === undefined || candidate === undefined) {
    throw new Error('debug service lacks the shared credential scenario');
  }
  return { credential, primary, candidate };
}

async function readProvidersInBrowser(page: Page, aliases: string[]) {
  return page.evaluate(
    async ({ api, requestedAliases }) => {
      const results: Array<{
        alias: string;
        credentialId?: string;
        hasSecret: boolean;
      }> = [];
      for (const alias of requestedAliases) {
        const response = await fetch(
          `${api}/v1/admin/model-providers/${encodeURIComponent(alias)}`,
        );
        if (!response.ok)
          throw new Error(`provider read failed: ${response.status}`);
        const envelope = (await response.json()) as {
          data: {
            alias: string;
            credentialId?: string;
            credential: { hasSecret: boolean };
          };
        };
        results.push({
          alias: envelope.data.alias,
          ...(envelope.data.credentialId === undefined
            ? {}
            : { credentialId: envelope.data.credentialId }),
          hasSecret: envelope.data.credential.hasSecret,
        });
      }
      return results;
    },
    { api: backend, requestedAliases: aliases },
  );
}

async function unlinkProviderCredential(
  request: APIRequestContext,
  alias: string,
): Promise<void> {
  const response = await request.post(
    `${backend}/v1/admin/model-providers/${encodeURIComponent(alias)}/credential/unlink`,
    { data: {} },
  );
  expect(response.ok()).toBe(true);
}

async function apiData<T>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const response = await request.get(`${backend}${path}`);
  expect(response.ok()).toBe(true);
  const envelope = (await response.json()) as { data: T };
  return envelope.data;
}
