import { names, type Tree } from '@nx/devkit';
import { join } from 'node:path';

export interface FixtureGeneratorSchema {
  name: string;
}

const FIXTURES_SOURCE_ROOT = 'libs/testing-fixtures/src';

/**
 * Scaffold a typed test fixture inside @rusty-view/testing-fixtures and export
 * it from the package barrel.
 *
 * Fixtures are typed `unknown` (never `any`) until #3182 wires them to the real
 * protocol/domain shapes, forcing consumers to narrow explicitly.
 */
export default async function fixtureGenerator(
  tree: Tree,
  schema: FixtureGeneratorSchema,
): Promise<void> {
  if (!schema.name) {
    throw new Error('rv:fixture requires a --name.');
  }
  const nm = names(schema.name);
  const dir = join(FIXTURES_SOURCE_ROOT, 'lib');
  const fileName = `${nm.fileName}.fixture`;
  const fixtureFile = join(dir, `${fileName}.ts`);

  if (tree.exists(fixtureFile)) {
    throw new Error(`A fixture already exists at ${fixtureFile}.`);
  }

  const varName = `${nm.propertyName}Fixture`;
  const listName = `${nm.propertyName}Fixtures`;

  tree.write(fixtureFile, renderFixtureTs(varName, listName));
  tree.write(
    join(dir, `${fileName}.spec.ts`),
    renderFixtureSpec(varName, listName, fileName),
  );

  appendToBarrel(tree, FIXTURES_SOURCE_ROOT, `./lib/${fileName}`);
}

function renderFixtureTs(varName: string, listName: string): string {
  return `/**
 * ${varName} — test fixture scaffolded by \`rv:fixture\`.
 *
 * TODO (#3182): type this against @rusty-view/protocol and
 * @rusty-view/chat-domain once those packages export real shapes. It is typed
 * \`unknown\` (never \`any\`) so consumers must narrow explicitly.
 */
export const ${varName}: unknown = {
  // TODO: replace with realistic fake data.
};

export const ${listName}: readonly unknown[] = Object.freeze([${varName}]);
`;
}

function renderFixtureSpec(
  varName: string,
  listName: string,
  fileName: string,
): string {
  return `import { ${varName}, ${listName} } from './${fileName}';

describe('${varName}', () => {
  it('exports a fixture and a frozen fixture list', () => {
    expect(${varName}).toBeDefined();
    expect(Array.isArray(${listName})).toBe(true);
    expect(Object.isFrozen(${listName})).toBe(true);
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
