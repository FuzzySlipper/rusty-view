import { getProjects, names, type Tree } from '@nx/devkit';
import { join } from 'node:path';

export interface StoreGeneratorSchema {
  name: string;
  project?: string;
  directory?: string;
}

/**
 * Scaffold an Angular signal store inside an existing library.
 */
export default async function storeGenerator(
  tree: Tree,
  schema: StoreGeneratorSchema,
): Promise<void> {
  if (!schema.name) throw new Error('rv:store requires --name.');

  const projectName = schema.project ?? 'chat-store';
  const project = getProjects(tree).get(projectName);
  if (!project) {
    throw new Error(`Project "${projectName}" not found in the workspace.`);
  }
  if (project.projectType !== 'library') {
    throw new Error(
      `rv:store targets library projects; "${projectName}" is not a library.`,
    );
  }

  const sourceRoot = project.sourceRoot ?? `libs/${projectName}/src`;
  const nm = names(schema.name);
  const dir = join(sourceRoot, 'lib', schema.directory ?? '');
  const fileName = `${nm.fileName}-store`;
  const className = `${nm.className}Store`;
  const storePath = join(dir, `${fileName}.ts`);

  if (tree.exists(storePath)) {
    throw new Error(`A store already exists at ${storePath}.`);
  }

  tree.write(storePath, renderStoreTs(className));
  tree.write(
    join(dir, `${fileName}.spec.ts`),
    renderStoreSpec(className, fileName),
  );
  appendToBarrel(
    tree,
    sourceRoot,
    `./lib/${schema.directory ? `${schema.directory}/` : ''}${fileName}`,
  );
}

function renderStoreTs(className: string): string {
  return `import { Injectable, signal } from '@angular/core';

export type ${className}Status = 'idle' | 'loading' | 'error';

/**
 * ${className} — signal store scaffolded by \`rv:store\`.
 *
 * Keep transport calls behind injected services and represent async work with
 * explicit loading/error state.
 */
@Injectable()
export class ${className} {
  private readonly _status = signal<${className}Status>('idle');

  readonly status = this._status.asReadonly();

  markLoading(): void {
    this._status.set('loading');
  }

  markIdle(): void {
    this._status.set('idle');
  }

  markError(): void {
    this._status.set('error');
  }
}
`;
}

function renderStoreSpec(className: string, fileName: string): string {
  return `import { TestBed } from '@angular/core/testing';

import { ${className} } from './${fileName}';

describe('${className}', () => {
  it('tracks status transitions', () => {
    TestBed.configureTestingModule({ providers: [${className}] });
    const store = TestBed.inject(${className});

    expect(store.status()).toBe('idle');
    store.markLoading();
    expect(store.status()).toBe('loading');
    store.markError();
    expect(store.status()).toBe('error');
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
