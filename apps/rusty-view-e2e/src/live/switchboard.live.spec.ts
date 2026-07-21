import { expect, test } from '@playwright/test';

const live = process.env['RV_SWITCHBOARD_LIVE_RUN'] === '1';
const backend = process.env['RV_LIVE_BACKEND_URL'] ?? 'http://127.0.0.1:9348';
const appUrl = process.env['RV_SWITCHBOARD_APP_URL'] ?? backend;

interface Envelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

interface DirectoryAgent {
  readonly agentId: string;
  readonly bindingId?: string | null;
  readonly runtimeKind: string;
  readonly routable: boolean;
}

interface Binding {
  readonly bindingId: string;
  readonly revision: number;
  readonly status: string;
}

interface RouteResolution {
  readonly route?: { readonly routeKey: string; readonly revision: number };
}

test.describe('Service switchboard @live-switchboard', () => {
  test.skip(
    !live,
    'set RV_SWITCHBOARD_LIVE_RUN=1 for the real Crew debug switchboard',
  );

  test('manages an exact managed alias and proves disabled delivery fails closed', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(240_000);
    const routeKey = `rv-view-5971-${Date.now()}`;
    const address = `@${routeKey}`;
    const replyMarker = `RV_SWITCHBOARD_5971_REPLY_${Date.now()}`;
    const errors: string[] = [];
    const coordinationRequestPaths: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/coordination/')) coordinationRequestPaths.push(path);
    });

    const [directoryResponse, bindingsResponse] = await Promise.all([
      request.get(`${backend}/v1/debug/coordination/agents`),
      request.get(`${backend}/v1/external-bindings`),
    ]);
    expect(directoryResponse.ok()).toBe(true);
    expect(bindingsResponse.ok()).toBe(true);
    const directory = (await directoryResponse.json()) as Envelope<{
      readonly deploymentRole: string;
      readonly agents: readonly DirectoryAgent[];
    }>;
    const bindingFleet = (await bindingsResponse.json()) as Envelope<{
      readonly bindings: readonly Binding[];
    }>;
    expect(directory.data.deploymentRole).toBe('debug');
    const activeBindings = new Map(
      bindingFleet.data.bindings
        .filter((binding) => binding.status === 'active')
        .map((binding) => [binding.bindingId, binding] as const),
    );
    const managedTargets = directory.data.agents.flatMap((agent) => {
      if (
        agent.runtimeKind !== 'codex_app_server' ||
        !agent.routable ||
        agent.bindingId === undefined ||
        agent.bindingId === null
      ) {
        return [];
      }
      const binding = activeBindings.get(agent.bindingId);
      return binding === undefined
        ? []
        : [
            {
              value: `managed:${agent.agentId}:${binding.bindingId}:${binding.revision}`,
              agentId: agent.agentId,
              bindingId: binding.bindingId,
              revision: binding.revision,
            },
          ];
    });
    expect(managedTargets.length).toBeGreaterThanOrEqual(2);
    const primary = managedTargets[0];
    const replacement = managedTargets.find(
      (target) => target.value !== primary?.value,
    );
    expect(primary).toBeDefined();
    expect(replacement).toBeDefined();
    if (primary === undefined || replacement === undefined) return;

    try {
      await page.setViewportSize({ width: 1600, height: 1000 });
      const targetUrl = new URL(appUrl);
      if (targetUrl.origin !== new URL(backend).origin) {
        targetUrl.searchParams.set('api', backend);
      }
      await page.goto(targetUrl.href);
      await page.locator('[data-menu-id="service"]').click();
      const servicePanel = page.getByTestId('top-menu-panel-service');
      await servicePanel.getByRole('button', { name: 'Switchboard' }).click();
      const switchboard = page.getByTestId('service-switchboard');
      await expect(switchboard).toBeVisible();
      await expect(switchboard).toContainText('debug');
      const editor = page.getByTestId('switchboard-editor');
      const targetSelect = editor.getByLabel('Exact target');
      await expect(
        targetSelect.locator(`option[value="${primary.value}"]`),
      ).toBeAttached({
        timeout: 30_000,
      });

      await editor.getByLabel('Route address').fill(routeKey);
      await editor.getByLabel('Operator label').fill('Task 5971 live proof');
      await editor
        .getByLabel('Description')
        .fill('Disposable debug-service managed route certification.');
      await targetSelect.selectOption(primary.value);
      await expect(editor).toContainText(`agent ${primary.agentId}`);
      await expect(editor).toContainText(
        `binding ${primary.bindingId} revision ${primary.revision}`,
      );
      await editor.getByRole('button', { name: 'Save route' }).click();

      const routeRow = switchboard.locator('tbody tr').filter({
        hasText: address,
      });
      await expect(routeRow).toBeVisible({ timeout: 30_000 });
      await expect(routeRow).toContainText(primary.bindingId);
      await routeRow.getByRole('button', { name: 'Resolve' }).click();
      const result = page.getByTestId('switchboard-result');
      await expect(result).toHaveAttribute('data-outcome', 'accepted');
      await expect(result).toContainText(primary.agentId);
      await page.screenshot({
        path: testInfo.outputPath('switchboard-created-resolved.png'),
        fullPage: true,
      });

      await editor
        .getByLabel('Message')
        .fill(`Reply exactly ${replyMarker} and nothing else.`);
      await editor.getByLabel('TTL seconds').fill('90');
      await routeRow.getByRole('button', { name: 'Round' }).click();
      await expect(result).toHaveAttribute('data-outcome', 'replied', {
        timeout: 120_000,
      });
      await expect(result).toContainText(replyMarker);

      await routeRow.getByRole('button', { name: 'Edit' }).click();
      await targetSelect.selectOption(replacement.value);
      await expect(editor).toContainText(`agent ${replacement.agentId}`);
      await editor.getByRole('button', { name: 'Save route' }).click();
      await expect(routeRow).toContainText(replacement.bindingId, {
        timeout: 30_000,
      });
      await routeRow.getByRole('button', { name: 'Disable' }).click();
      await expect(routeRow).toContainText('disabled');
      await expect(routeRow).toContainText('agent_route_disabled');
      await routeRow.getByRole('button', { name: 'Resolve' }).click();
      await expect(result).toHaveAttribute('data-outcome', 'rejected');
      await expect(result).toContainText('agent_route_disabled');
      await page.screenshot({
        path: testInfo.outputPath('switchboard-repointed-disabled.png'),
        fullPage: true,
      });

      page.once('dialog', (dialog) => dialog.accept());
      await routeRow.getByRole('button', { name: 'Delete' }).click();
      await expect(routeRow).toHaveCount(0, { timeout: 30_000 });
      expect(coordinationRequestPaths).toContain(
        '/v1/debug/coordination/agents',
      );
      expect(
        coordinationRequestPaths.filter((path) =>
          path.startsWith('/v1/coordination/'),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      const routesResponse = await request.get(
        `${backend}/v1/debug/coordination/routes`,
      );
      if (routesResponse.ok()) {
        const routes = (await routesResponse.json()) as Envelope<{
          readonly routes: readonly RouteResolution[];
        }>;
        const route = routes.data.routes.find(
          (resolution) => resolution.route?.routeKey === routeKey,
        )?.route;
        if (route !== undefined) {
          await request.delete(
            `${backend}/v1/debug/coordination/routes/${encodeURIComponent(routeKey)}?expectedRevision=${route.revision}`,
          );
        }
      }
    }
  });
});
