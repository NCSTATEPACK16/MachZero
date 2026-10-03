#!/usr/bin/env node
/**
 * The CI smoke job runs in mcr.microsoft.com/playwright:v<version>-noble, which only carries the browsers
 * for that exact Playwright version. Fail fast with a clear message if package.json moved on without it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const installed = JSON.parse(readFileSync(resolve(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version;
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
const image = workflow.match(/mcr\.microsoft\.com\/playwright:v([\d.]+)-/)?.[1];
if (image !== installed) {
  console.error(`✗ CI image is Playwright v${image ?? '?'} but @playwright/test is ${installed}. Update the image tag in .github/workflows/ci.yml.`);
  process.exit(1);
}
console.log(`✓ Playwright ${installed} matches the CI image`);
