#!/usr/bin/env node
/**
 * Protocol generated-types drift check.
 *
 * Regenerates the wire types from the OpenAPI source using the SAME CLI path as
 * `nx run protocol:generate`, writes them to a temp file, and fails if the
 * output differs from the checked-in `src/generated/openapi.ts`. Run via
 * `nx run protocol:check`.
 *
 * Source resolution: the `RUSTY_VIEW_OPENAPI_SOURCE` env var, defaulting to the
 * sibling rusty-crew artifact
 * (/home/dev/rusty-crew/docs/rusty-view-chat-api-v0.openapi.json).
 *
 * If the source artifact is absent (e.g. a CI checkout without the backend
 * repo co-located), drift cannot be measured, so the check exits 0 with a
 * visible warning rather than failing. Drift detection is meaningful on dev
 * machines where both repos are present.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CONTRACTS = [
  {
    name: 'chat',
    source:
      process.env['RUSTY_VIEW_OPENAPI_SOURCE'] ??
      '/home/dev/rusty-crew/docs/rusty-view-chat-api-v0.openapi.json',
    checkedIn: join(
      REPO_ROOT,
      'libs',
      'protocol',
      'src',
      'generated',
      'openapi.ts',
    ),
  },
  {
    name: 'external runtime',
    source:
      process.env['RUSTY_VIEW_EXTERNAL_OPENAPI_SOURCE'] ??
      '/home/dev/rusty-crew/docs/external-runtime-api-v0.openapi.json',
    checkedIn: join(
      REPO_ROOT,
      'libs',
      'protocol',
      'src',
      'generated',
      'external-openapi.ts',
    ),
  },
  {
    name: 'provider admin',
    source:
      process.env['RUSTY_VIEW_PROVIDER_ADMIN_OPENAPI_SOURCE'] ??
      '/home/dev/rusty-crew/docs/model-provider-admin-api-v0.openapi.json',
    checkedIn: join(
      REPO_ROOT,
      'libs',
      'protocol',
      'src',
      'generated',
      'provider-admin-openapi.ts',
    ),
  },
];

const tmpDir = mkdtempSync(join(tmpdir(), 'rv-protocol-check-'));
try {
  for (const contract of CONTRACTS) {
    if (!existsSync(contract.source)) {
      console.warn(
        `[protocol:check] ${contract.name} OpenAPI source not found at ` +
          `${contract.source}; skipping its drift check.`,
      );
      continue;
    }
    if (!existsSync(contract.checkedIn)) {
      console.error(
        `[protocol:check] Checked-in ${contract.name} generated file not found. ` +
          'Run `nx run protocol:generate` and commit the output.',
      );
      process.exit(1);
    }
    const generatedPath = join(
      tmpDir,
      `${contract.name.replaceAll(' ', '-')}.ts`,
    );
    execFileSync(
      'pnpm',
      ['exec', 'openapi-typescript', contract.source, '-o', generatedPath],
      { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    if (
      readFileSync(generatedPath, 'utf8') !==
      readFileSync(contract.checkedIn, 'utf8')
    ) {
      console.error(
        `[protocol:check] Generated ${contract.name} wire types are out of sync ` +
          `with ${contract.source}.`,
      );
      console.error('  Run `nx run protocol:generate`, review, and commit.');
      process.exit(1);
    }
  }
  console.log('[protocol:check] Generated wire types are in sync.');
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
