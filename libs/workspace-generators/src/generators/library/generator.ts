import { libraryGenerator as angularLibraryGenerator } from '@nx/angular/generators';
import { libraryGenerator as jsLibraryGenerator } from '@nx/js';
import type { Tree } from '@nx/devkit';

export interface LibraryGeneratorSchema {
  name: string;
  type: 'angular' | 'js';
  scope: string;
  directory?: string;
  importPath?: string;
  prefix?: string;
}

/**
 * Boundary scopes allowed inside rusty-view. Adding a new scope is an
 * architecture decision — it must also be reflected in the module-boundary lint
 * (eslint.config.mjs) and agents-project.md before it can be used here.
 */
const ALLOWED_SCOPES: ReadonlySet<string> = new Set<string>([
  'protocol',
  'transport',
  'chat-domain',
  'chat-store',
  'chat-theme',
  'transcript-renderer',
  'chat-components',
  'chat-shell',
  'design-tokens',
  'testing-fixtures',
  'workspace-generators',
]);

/**
 * Scaffold a boundary-tagged library by delegating to Nx's library generators
 * with rusty-view conventions (strict TS, vitest, eslint, css, OnPush, rv
 * prefix) and a validated `scope` tag.
 *
 * Delegates rather than hand-scaffolds so the result stays in lockstep with Nx's
 * library layout. The only policy added here is boundary-tag enforcement.
 */
export default async function libraryGenerator(
  tree: Tree,
  schema: LibraryGeneratorSchema,
): Promise<void> {
  if (!schema.name) {
    throw new Error('rv:library requires --name.');
  }
  if (!schema.scope) {
    throw new Error(
      'rv:library requires --scope (a rusty-view boundary scope).',
    );
  }
  if (!ALLOWED_SCOPES.has(schema.scope)) {
    throw new Error(
      `Unknown scope "${schema.scope}". Allowed scopes: ${[
        ...ALLOWED_SCOPES,
      ].join(
        ', ',
      )}. A new scope is an architecture decision — add it to eslint.config.mjs ` +
        `and agents-project.md before allowing it here.`,
    );
  }

  const kind = schema.type;
  const directory = schema.directory ?? `libs/${schema.name}`;
  const importPath = schema.importPath ?? `@rusty-view/${schema.name}`;
  const typeTag =
    schema.scope === 'testing-fixtures' ? 'type:testing' : 'type:lib';
  const tags = `${typeTag},scope:${schema.scope}`;

  if (kind === 'angular') {
    await angularLibraryGenerator(tree, {
      name: schema.name,
      directory,
      importPath,
      buildable: true,
      standalone: true,
      style: 'css',
      changeDetection: 'OnPush',
      prefix: schema.prefix ?? 'rv',
      unitTestRunner: 'vitest-angular',
      linter: 'eslint',
      tags,
    });
    return;
  }

  await jsLibraryGenerator(tree, {
    name: schema.name,
    directory,
    importPath,
    bundler: 'tsc',
    unitTestRunner: 'vitest',
    linter: 'eslint',
    strict: true,
    tags,
  });
}
