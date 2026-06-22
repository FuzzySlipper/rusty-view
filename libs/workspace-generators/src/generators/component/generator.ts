import { getProjects, names, type Tree } from '@nx/devkit';
import { join } from 'node:path';

export interface ComponentGeneratorSchema {
  name: string;
  project: string;
  selectorPrefix?: string;
}

/**
 * Scaffold a presentational component (OnPush, standalone, `rv-` kebab selector,
 * strictly-typed signal input/output) inside an existing @rusty-view library,
 * and export it from the library's public barrel.
 *
 * Boundary intent: every component produced here is dumb/presentational by
 * construction — no service injection, no store access, no domain logic.
 */
export default async function componentGenerator(
  tree: Tree,
  schema: ComponentGeneratorSchema,
): Promise<void> {
  if (!schema.name) {
    throw new Error('rv:component requires a --name.');
  }
  if (!schema.project) {
    throw new Error(
      'rv:component requires --project (an existing @rusty-view library).',
    );
  }

  const projects = getProjects(tree);
  const project = projects.get(schema.project);
  if (!project) {
    throw new Error(`Project "${schema.project}" not found in the workspace.`);
  }
  if (project.projectType !== 'library') {
    throw new Error(
      `rv:component targets library projects; "${schema.project}" is not a library.`,
    );
  }

  const sourceRoot = project.sourceRoot ?? `libs/${schema.project}/src`;
  const nm = names(schema.name);
  const prefix = schema.selectorPrefix ?? 'rv';
  const componentDir = join(sourceRoot, 'lib', nm.fileName);
  const componentFile = join(componentDir, `${nm.fileName}.ts`);

  if (tree.exists(componentFile)) {
    throw new Error(`A component already exists at ${componentFile}.`);
  }

  const className = `${nm.className}Component`;
  const selector = `${prefix}-${nm.fileName}`;

  tree.write(
    componentFile,
    renderComponentTs(className, selector, nm.fileName),
  );
  tree.write(
    join(componentDir, `${nm.fileName}.html`),
    renderComponentHtml(className),
  );
  tree.write(join(componentDir, `${nm.fileName}.css`), COMPONENT_CSS);
  tree.write(
    join(componentDir, `${nm.fileName}.spec.ts`),
    renderComponentSpec(className, nm.fileName),
  );

  appendToBarrel(tree, sourceRoot, `./lib/${nm.fileName}/${nm.fileName}`);

  // The component now imports @angular/core, so the host library must declare
  // it as a peerDependency to keep @nx/dependency-checks green.
  ensureAngularCorePeerDep(tree, project.root);
}

function renderComponentTs(
  className: string,
  selector: string,
  fileName: string,
): string {
  return `import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * ${className} — presentational component scaffolded by \`rv:component\`.
 *
 * Boundary rules (docs/rusty-view.md): no service injection, no store access,
 * no domain logic. Receive data via signal inputs and emit via signal outputs.
 * Provide empty / loading / error / long-content states as the component needs.
 */
@Component({
  selector: '${selector}',
  templateUrl: './${fileName}.html',
  styleUrl: './${fileName}.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ${className} {
  // TODO: replace placeholder I/O with the component's real typed contract.
  readonly data = input<unknown>();
  readonly action = output<string>();
}
`;
}

function renderComponentHtml(className: string): string {
  return `<!-- ${className}: presentational placeholder. -->
<!-- TODO: implement empty / loading / error / long-content states. -->
<div class="rv-placeholder">
  <p>${className}</p>
</div>
`;
}

const COMPONENT_CSS = `:host {
  display: block;
}

.rv-placeholder {
  padding: var(--rv-space-md);
  border: 1px dashed var(--rv-color-border);
  border-radius: var(--rv-radius);
  color: var(--rv-color-text-secondary);
  font-family: var(--rv-font-mono);
  font-size: var(--rv-font-size-sm);
}
`;

function renderComponentSpec(className: string, fileName: string): string {
  return `import { TestBed } from '@angular/core/testing';

import { ${className} } from './${fileName}';

describe('${className}', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [${className}],
    }).compileComponents();
  });

  it('creates the component', () => {
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
  if (current.includes(modulePath)) {
    return; // already exported
  }
  const next =
    current === '' || current.endsWith('\n')
      ? current + exportLine
      : current + '\n' + exportLine;
  tree.write(barrel, next);
}

/**
 * Ensure the host library declares @angular/core as a peerDependency, using the
 * version pinned at the workspace root. Generated components import @angular/core
 * (signal input/output), so the host library must surface that as a peer.
 */
function ensureAngularCorePeerDep(tree: Tree, projectRoot: string): void {
  const pkgPath = join(projectRoot, 'package.json');
  if (!tree.exists(pkgPath)) {
    return; // project has no package.json; nothing to update
  }
  const rootBuffer = tree.read('package.json');
  // JSON.parse is untyped; narrow to the expected package.json dependency shape.
  const rootJson = rootBuffer
    ? (JSON.parse(rootBuffer.toString('utf8')) as {
        dependencies?: Record<string, string>;
      })
    : {};
  const coreVersion = rootJson.dependencies?.['@angular/core'] ?? '^21.0.0';

  const pkgBuffer = tree.read(pkgPath);
  if (!pkgBuffer) {
    return;
  }
  // JSON.parse is untyped; narrow to the expected peerDependencies shape.
  const pkgJson = JSON.parse(pkgBuffer.toString('utf8')) as {
    peerDependencies?: Record<string, string>;
  };
  if (pkgJson.peerDependencies?.['@angular/core']) {
    return; // already declared
  }
  pkgJson.peerDependencies = sortStringRecord({
    ...pkgJson.peerDependencies,
    '@angular/core': coreVersion,
  });
  tree.write(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
}

function sortStringRecord(
  value: Record<string, string>,
): Record<string, string> {
  return Object.keys(value)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      const entry = value[key];
      if (entry !== undefined) {
        acc[key] = entry;
      }
      return acc;
    }, {});
}
