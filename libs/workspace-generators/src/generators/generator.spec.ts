import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it } from 'vitest';

import featureGenerator from './feature/generator';
import liveScenarioGenerator from './live-scenario/generator';
import storeGenerator from './store/generator';

function seedProject(
  tree: ReturnType<typeof createTreeWithEmptyWorkspace>,
  name: string,
  sourceRoot: string,
): void {
  tree.write(
    `${sourceRoot.replace('/src', '')}/project.json`,
    JSON.stringify({
      name,
      projectType: 'library',
      sourceRoot,
      tags: ['type:lib', `scope:${name}`],
    }),
  );
  tree.write(`${sourceRoot}/index.ts`, '');
}

describe('workspace generators', () => {
  it('scaffolds a bounded feature slice and exports it', async () => {
    const tree = createTreeWithEmptyWorkspace();
    seedProject(tree, 'chat-shell', 'libs/chat-shell/src');

    await featureGenerator(tree, {
      name: 'profile drawer',
      project: 'chat-shell',
    });

    const componentPath =
      'libs/chat-shell/src/lib/features/profile-drawer/profile-drawer.ts';
    expect(tree.exists(componentPath)).toBe(true);
    expect(tree.read(componentPath, 'utf8')).toContain(
      'ProfileDrawerFeatureComponent',
    );
    expect(tree.read('libs/chat-shell/src/index.ts', 'utf8')).toContain(
      './lib/features/profile-drawer/profile-drawer',
    );
  });

  it('scaffolds a signal store and exports it', async () => {
    const tree = createTreeWithEmptyWorkspace();
    seedProject(tree, 'chat-store', 'libs/chat-store/src');

    await storeGenerator(tree, {
      name: 'profile editor',
      project: 'chat-store',
    });

    const storePath = 'libs/chat-store/src/lib/profile-editor-store.ts';
    expect(tree.exists(storePath)).toBe(true);
    expect(tree.read(storePath, 'utf8')).toContain('ProfileEditorStore');
    expect(tree.read('libs/chat-store/src/index.ts', 'utf8')).toContain(
      './lib/profile-editor-store',
    );
  });

  it('scaffolds a live Playwright scenario with evidence guidance', async () => {
    const tree = createTreeWithEmptyWorkspace();

    await liveScenarioGenerator(tree, {
      name: 'reasoning regression',
      tags: '@reasoning @controls',
    });

    const scenarioPath =
      'apps/rusty-view-e2e/src/live/reasoning-regression.live.spec.ts';
    expect(tree.exists(scenarioPath)).toBe(true);
    const scenario = tree.read(scenarioPath, 'utf8');
    expect(scenario).toContain("import { test } from './live-fixture'");
    expect(scenario).toContain('@reasoning @controls @live-agent');
    expect(scenario).toContain('Manual close criterion');
  });
});
