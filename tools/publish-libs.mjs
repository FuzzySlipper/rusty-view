#!/usr/bin/env node
/**
 * Publish the @rusty-view/* libraries to a registry for cross-repo consumption.
 *
 * Why this exists: the libs are consumed by other repos. Inside this workspace
 * they link via `workspace:*` specifiers and tsconfig paths, but `workspace:*`
 * does not resolve once installed elsewhere, and the
 * ng-packagr / tsc dist output is the thing that gets published — not the
 * source package. ng-packagr cannot rewrite the workspace protocol, so this
 * tool does the two things needed to make the built artifacts installable
 * anywhere:
 *
 *   1. rewrite `workspace:*` (and any `@rusty-view/*` range) to `^<version>`;
 *   2. drop `private` from the built package.json (source stays private so the
 *      source dir can never be published by accident).
 *
 * The Angular libs are built in PARTIAL compilation mode (see each lib's
 * tsconfig.lib.prod.json `compilationMode: "partial"`), so the consuming app's
 * Angular linker integrates them. Full-compiled output is not consumable
 * cross-repo (signal-input bindings fail; NG0203 under the dev server).
 *
 * Usage:
 *   node tools/publish-libs.mjs --version 0.0.3 [--registry http://localhost:4873/] [--dry-run]
 *   pnpm publish:libs -- --version 0.0.3
 *
 * Auth: publishing to the local verdaccio needs a token once, e.g.
 *   npm config set //localhost:4873/:_authToken "local-dev"
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Libraries published for external consumers. Test-only (testing-fixtures) and
// internal tooling (workspace-generators) are intentionally excluded.
const PUBLISHABLE = [
  'protocol',
  'transport',
  'chat-domain',
  'design-tokens',
  'chat-store',
  'chat-theme',
  'transcript-renderer',
  'chat-components',
  'chat-shell',
];

function parseArgs(argv) {
  const args = {
    registry: 'http://localhost:4873/',
    dryRun: false,
    version: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') args.version = argv[++i];
    else if (argv[i] === '--registry') args.registry = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function main() {
  const { version, registry, dryRun } = parseArgs(process.argv.slice(2));
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
    console.error(
      'error: --version <semver> is required, e.g. --version 0.0.3',
    );
    process.exit(1);
  }
  const repoRoot = process.cwd();

  console.log(`Building ${PUBLISHABLE.length} libraries…`);
  execSync(
    `pnpm exec nx run-many -t build --projects=${PUBLISHABLE.join(',')}`,
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  );
  execSync('node tools/fix-package-esm-specifiers.mjs --write', {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  for (const lib of PUBLISHABLE) {
    const dir = join(repoRoot, 'dist', 'libs', lib);
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) {
      console.error(`error: ${pkgPath} not found — did the build succeed?`);
      process.exit(1);
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    delete pkg.private;
    pkg.version = version;
    for (const field of ['dependencies', 'peerDependencies']) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (
          typeof spec === 'string' &&
          (spec.startsWith('workspace:') || name.startsWith('@rusty-view/'))
        ) {
          deps[name] = `^${version}`;
        }
      }
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    if (dryRun) {
      console.log(
        `[dry-run] would publish ${pkg.name}@${version} → ${registry}`,
      );
      continue;
    }
    try {
      execSync(`npm publish --registry ${registry}`, {
        cwd: dir,
        stdio: 'pipe',
      });
      console.log(`published ${pkg.name}@${version}`);
    } catch (e) {
      const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      if (
        /cannot publish over|EPUBLISHCONFLICT|previously published/i.test(out)
      ) {
        console.log(`exists  ${pkg.name}@${version} (already published)`);
      } else {
        console.error(
          `FAILED  ${pkg.name}: ${(out.match(/npm error \S.*/g) || [out]).slice(0, 2).join(' | ')}`,
        );
        process.exitCode = 1;
      }
    }
  }
}

main();
