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
const CHECKED_IN = join(
  REPO_ROOT,
  'libs',
  'protocol',
  'src',
  'generated',
  'openapi.ts',
);

const SOURCE =
  process.env['RUSTY_VIEW_OPENAPI_SOURCE'] ??
  '/home/dev/rusty-crew/docs/rusty-view-chat-api-v0.openapi.json';

if (!existsSync(SOURCE)) {
  console.warn(
    `[protocol:check] OpenAPI source not found at ${SOURCE}; skipping drift ` +
      'check (source is required to measure drift).',
  );
  process.exit(0);
}
if (!existsSync(CHECKED_IN)) {
  console.error(
    `[protocol:check] Checked-in generated file not found at ${CHECKED_IN}. ` +
      'Run `nx run protocol:generate` and commit the output.',
  );
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'rv-protocol-check-'));
const generatedPath = join(tmpDir, 'openapi.ts');
try {
  execFileSync(
    'pnpm',
    ['exec', 'openapi-typescript', SOURCE, '-o', generatedPath],
    { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );

  const fresh = readFileSync(generatedPath, 'utf8');
  const checkedIn = readFileSync(CHECKED_IN, 'utf8');

  if (fresh === checkedIn) {
    console.log('[protocol:check] Generated wire types are in sync.');
    process.exit(0);
  }

  console.error(
    '[protocol:check] Generated wire types are out of sync with the OpenAPI ' +
      `source (${SOURCE}).`,
  );
  console.error(
    '  Run `nx run protocol:generate`, review the diff, and commit the result.',
  );
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
