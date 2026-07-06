#!/usr/bin/env node
/**
 * ng-packagr emits ESM files with extensionless relative specifiers such as
 * `export * from './index'`. Bundlers tolerate that, but Node ESM/Vitest
 * consumers require the generated `.js` extension in published packages.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distLibsRoot = join(repoRoot, 'dist', 'libs');
const mode = parseMode(process.argv.slice(2));

if (!existsSync(distLibsRoot)) {
  fail(
    `${distLibsRoot} does not exist; build packages before checking ESM specifiers`,
  );
}

let changedFiles = 0;
let unresolved = 0;

for (const file of walkJsFiles(distLibsRoot)) {
  const source = readFileSync(file, 'utf8');
  const rewritten = rewriteSpecifiers(file, source);
  if (rewritten === source) continue;

  changedFiles++;
  if (mode === 'write') {
    writeFileSync(file, rewritten);
  } else {
    console.error(`extensionless ESM specifiers in ${relative(file)}`);
  }
}

if (mode === 'check' && changedFiles > 0) {
  fail(`${changedFiles} generated ESM file(s) need .js relative specifiers`);
}

if (unresolved > 0) {
  fail(`${unresolved} relative ESM specifier(s) could not be resolved`);
}

console.log(
  mode === 'write'
    ? `ESM specifier rewrite complete (${changedFiles} file(s) updated)`
    : 'ESM specifier check passed',
);

function parseMode(args) {
  if (args.includes('--check')) return 'check';
  if (args.includes('--write')) return 'write';
  return 'check';
}

function* walkJsFiles(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsFiles(path);
    } else if (entry.isFile() && path.endsWith('.js') && isEsmFile(path)) {
      yield path;
    }
  }
}

function isEsmFile(path) {
  return path.includes(`${pathSeparator()}esm2022${pathSeparator()}`);
}

function pathSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

function rewriteSpecifiers(file, source) {
  return source
    .replace(
      /\b(import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g,
      (match, prefix, specifier) =>
        replaceSpecifier(file, match, prefix, specifier),
    )
    .replace(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g, (match, specifier) =>
      replaceSpecifier(file, match, 'from ', specifier),
    )
    .replace(/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g, (match, specifier) =>
      replaceSpecifier(file, match, 'import ', specifier),
    );
}

function replaceSpecifier(file, match, prefix, specifier) {
  const next = resolveJsSpecifier(file, specifier);
  if (next === specifier) return match;
  const quote = match.includes('"') ? '"' : "'";
  return `${prefix}${quote}${next}${quote}`;
}

function resolveJsSpecifier(file, specifier) {
  if (hasExplicitExtension(specifier)) return specifier;

  const base = resolve(dirname(file), specifier);
  if (existsSync(`${base}.js`) && statSync(`${base}.js`).isFile()) {
    return `${specifier}.js`;
  }
  const indexPath = join(base, 'index.js');
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    return specifier.endsWith('/')
      ? `${specifier}index.js`
      : `${specifier}/index.js`;
  }

  unresolved++;
  console.error(`unable to resolve ${specifier} from ${relative(file)}`);
  return specifier;
}

function hasExplicitExtension(specifier) {
  return extname(specifier) !== '';
}

function relative(path) {
  return path.replace(`${repoRoot}/`, '');
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
