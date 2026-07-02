import { getProjects, names, type Tree } from '@nx/devkit';
import { join } from 'node:path';

export interface FeatureGeneratorSchema {
  name: string;
  project: string;
  directory?: string;
  selectorPrefix?: string;
}

/**
 * Scaffold a bounded feature component inside an Angular library.
 *
 * Features are composition-oriented UI slices. They may wire stores and
 * presentational components, but should stay inside their feature directory so
 * chat-shell does not grow another flat pile of files.
 */
export default async function featureGenerator(
  tree: Tree,
  schema: FeatureGeneratorSchema,
): Promise<void> {
  if (!schema.name) throw new Error('rv:feature requires --name.');
  if (!schema.project) throw new Error('rv:feature requires --project.');

  const project = getProjects(tree).get(schema.project);
  if (!project) {
    throw new Error(`Project "${schema.project}" not found in the workspace.`);
  }
  if (project.projectType !== 'library') {
    throw new Error(
      `rv:feature targets library projects; "${schema.project}" is not a library.`,
    );
  }

  const sourceRoot = project.sourceRoot ?? `libs/${schema.project}/src`;
  const nm = names(schema.name);
  const featureRoot = schema.directory ?? 'features';
  const dir = join(sourceRoot, 'lib', featureRoot, nm.fileName);
  const className = `${nm.className}FeatureComponent`;
  const selector = `${schema.selectorPrefix ?? 'rv'}-${nm.fileName}-feature`;

  const componentPath = join(dir, `${nm.fileName}.ts`);
  if (tree.exists(componentPath)) {
    throw new Error(`A feature already exists at ${componentPath}.`);
  }

  tree.write(componentPath, renderFeatureTs(className, selector, nm.fileName));
  tree.write(join(dir, `${nm.fileName}.html`), renderFeatureHtml(className));
  tree.write(join(dir, `${nm.fileName}.css`), FEATURE_CSS);
  tree.write(
    join(dir, `${nm.fileName}.spec.ts`),
    renderFeatureSpec(className, nm.fileName),
  );

  appendToBarrel(
    tree,
    sourceRoot,
    `./lib/${featureRoot}/${nm.fileName}/${nm.fileName}`,
  );
}

function renderFeatureTs(
  className: string,
  selector: string,
  fileName: string,
): string {
  return `import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * ${className} — bounded feature slice scaffolded by \`rv:feature\`.
 *
 * Keep composition logic local to this directory. Extract presentational UI to
 * chat-components or a sibling component when it becomes reusable.
 */
@Component({
  selector: '${selector}',
  templateUrl: './${fileName}.html',
  styleUrl: './${fileName}.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ${className} {
  readonly title = input<string>('${className}');
}
`;
}

function renderFeatureHtml(className: string): string {
  return `<section class="rv-feature" data-testid="${className}">
  <h2>{{ title() }}</h2>
</section>
`;
}

const FEATURE_CSS = `:host {
  display: block;
}

.rv-feature {
  display: grid;
  gap: var(--rv-space-sm);
}
`;

function renderFeatureSpec(className: string, fileName: string): string {
  return `import { TestBed } from '@angular/core/testing';

import { ${className} } from './${fileName}';

describe('${className}', () => {
  it('creates the feature component', () => {
    TestBed.configureTestingModule({ imports: [${className}] });
    const fixture = TestBed.createComponent(${className});
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });
});
`;
}

function appendToBarrel(
  tree: Tree,
  sourceRoot: string,
  modulePath: string,
): void {
  const barrel = join(sourceRoot, 'index.ts');
  const exportLine = `export * from '${modulePath}';\n`;
  const current = tree.exists(barrel)
    ? (tree.read(barrel)?.toString() ?? '')
    : '';
  if (current.includes(modulePath)) return;
  tree.write(
    barrel,
    current === '' || current.endsWith('\n')
      ? current + exportLine
      : `${current}\n${exportLine}`,
  );
}
