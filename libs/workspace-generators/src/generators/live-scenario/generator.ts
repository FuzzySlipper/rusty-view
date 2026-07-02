import { names, type Tree } from '@nx/devkit';
import { join } from 'node:path';

export interface LiveScenarioGeneratorSchema {
  name: string;
  tags?: string;
}

const LIVE_DIR = 'apps/rusty-view-e2e/src/live';

/**
 * Scaffold a real-backend/live-LLM Playwright scenario.
 */
export default async function liveScenarioGenerator(
  tree: Tree,
  schema: LiveScenarioGeneratorSchema,
): Promise<void> {
  if (!schema.name) throw new Error('rv:live-scenario requires --name.');

  const nm = names(schema.name);
  const path = join(LIVE_DIR, `${nm.fileName}.live.spec.ts`);
  if (tree.exists(path)) {
    throw new Error(`A live scenario already exists at ${path}.`);
  }

  tree.write(
    path,
    renderLiveScenario(nm.fileName, schema.tags ?? '@generated'),
  );
}

function renderLiveScenario(fileName: string, tags: string): string {
  return `import { test } from './live-fixture';

// Assertions live in live fixture helpers so every scenario leaves an evidence packet.
// eslint-disable-next-line playwright/expect-expect
test('${fileName} real conversation ${tags} @live-agent', async ({ live }) => {
  test.setTimeout(300_000);
  await live.requireLiveRun();
  await live.openAppAndSelectProfile();

  await live.runTurn({
    prompt: [
      'Live UI verification:',
      'Use the real configured Rusty Crew profile and provider.',
      'Produce a response long enough that screenshots and transcript artifacts show real rendered impact.',
    ].join('\\n'),
    assistantCompletedTimeoutMs: 240_000,
  });

  live.note(
    'Manual close criterion: inspect the evidence packet and screenshots; the requested behavior must be visible in the actual rendered chat UI.',
  );
});
`;
}
