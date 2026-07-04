#!/usr/bin/env node
/**
 * Smoke check for the publishable @rusty-view/design-tokens package.
 *
 * Downstream apps need a stable CSS import path, not only the typed token-name
 * JS exports. This verifies the built dist package exposes tokens.css at the
 * package root before a publish dry-run can look healthy.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const packageRoot = join(root, 'dist', 'libs', 'design-tokens');
const packageJsonPath = join(packageRoot, 'package.json');
const cssPath = join(packageRoot, 'tokens.css');

function fail(message) {
  console.error(`design-tokens package smoke failed: ${message}`);
  process.exit(1);
}

if (!existsSync(packageJsonPath)) {
  fail(`${packageJsonPath} does not exist; run nx build design-tokens first`);
}

if (!existsSync(cssPath)) {
  fail(`${cssPath} does not exist`);
}

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
if (pkg.exports?.['./tokens.css'] !== './tokens.css') {
  fail('package.json must export "./tokens.css" as "./tokens.css"');
}

if (!Array.isArray(pkg.files) || !pkg.files.includes('tokens.css')) {
  fail('package.json files must include "tokens.css"');
}

const css = readFileSync(cssPath, 'utf8');
for (const expected of [
  ':root',
  '--rv-color-bg:',
  "[data-rv-theme='dark']",
  "[data-rv-theme='light']",
  "[data-rv-theme='high-contrast']",
]) {
  if (!css.includes(expected)) {
    fail(`tokens.css is missing expected content: ${expected}`);
  }
}

console.log('design-tokens package smoke: tokens.css exported and present');
