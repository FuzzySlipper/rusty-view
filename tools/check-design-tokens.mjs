#!/usr/bin/env node
/*
 * Design-token green-path guard (task #3691).
 *
 * Enforces that component stylesheets reskin only through semantic design
 * tokens, so the whole app stays theme-able from one place and future UI
 * (including agent-authored components) can't invent values that escape the
 * theme. Dependency-free so it runs anywhere without installing stylelint.
 *
 * In component CSS (everything under libs/<lib>/src excluding the token
 * definition file) it flags:
 *   1. raw colour literals (hex / rgb() / rgba() / hsl() / hsla());
 *   2. `var(--rv-…, <fallback>)` fallback literals (they mask token drift);
 *   3. references to `--rv-*` tokens not defined in tokens.css (typos /
 *      invented tokens).
 *
 * The set of valid tokens is read from tokens.css itself (the single source of
 * truth), so the allowlist never goes stale.
 *
 * Usage: node tools/check-design-tokens.mjs
 * Exits non-zero (with a report) when any violation is found.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const TOKENS_CSS = join(ROOT, 'libs/design-tokens/src/styles/tokens.css');

/** Recursively collect *.css files under a dir. */
function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Strip /* *​/ block comments so commented examples aren't flagged. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const tokensSource = readFileSync(TOKENS_CSS, 'utf8');
const definedTokens = new Set(
  [...tokensSource.matchAll(/(--rv-[\w-]+)\s*:/g)].map((m) => m[1]),
);

const libsDir = join(ROOT, 'libs');
const files = cssFiles(libsDir).filter((f) => f !== TOKENS_CSS);

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;
const FALLBACK_VAR = /var\(\s*--rv-[\w-]+\s*,/;
const TOKEN_REF = /var\(\s*(--rv-[\w-]+)/g;

const violations = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (RAW_COLOR.test(line)) {
      violations.push(
        `${rel}:${ln}  raw colour literal — use a var(--rv-color-*) token`,
      );
    }
    if (FALLBACK_VAR.test(line)) {
      violations.push(
        `${rel}:${ln}  var(--rv-*, fallback) literal — drop the fallback; define the token in tokens.css`,
      );
    }
    for (const m of line.matchAll(TOKEN_REF)) {
      if (!definedTokens.has(m[1])) {
        violations.push(
          `${rel}:${ln}  unknown design token ${m[1]} — add it to tokens.css or fix the name`,
        );
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `\nDesign-token guard found ${violations.length} violation(s):\n`,
  );
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(
    '\nComponent styles must reference semantic --rv-* tokens (no raw colours, no fallbacks, no unknown tokens).',
  );
  console.error('See docs/theming.md for the green path.\n');
  process.exit(1);
}

console.log(
  `Design-token guard: ${files.length} stylesheet(s) clean; ${definedTokens.size} tokens defined.`,
);
