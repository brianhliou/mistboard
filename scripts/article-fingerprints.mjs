#!/usr/bin/env node
// Re-record the committed article content fingerprints
// (apps/web/src/articles/content-fingerprints.json).
//
//   npm run articles:fingerprint                      # record new pages and date bumps
//   npm run articles:fingerprint -- --minor <slug>    # also accept a text edit under
//                                                      # an unchanged updatedAt
//
// A page whose reader text changed while its `updatedAt` did not is refused
// unless it is named with --minor: bump `updatedAt` and write an `updateNote`
// for a change a returning reader would want to know about, and keep --minor
// for a typo, a reworded caption or a link fix. The logic lives in
// apps/web/src/article-fingerprint.ts; this runs its test in update mode so the
// articles load through the same Vite/Vitest graph the gate uses.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const minor = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--minor') {
    const slug = args[i + 1];
    if (!slug || slug.startsWith('--')) {
      console.error('--minor needs a slug');
      process.exit(2);
    }
    minor.push(slug);
    i += 1;
  } else if (arg.startsWith('--minor=')) {
    minor.push(arg.slice('--minor='.length));
  } else {
    console.error(
      `unknown argument: ${arg}\nusage: npm run articles:fingerprint [-- --minor <slug> ...]`,
    );
    process.exit(2);
  }
}

const result = spawnSync(
  'npm',
  ['run', 'test:unit', '--workspace', '@mistboard/web', '--', 'src/articles-fingerprint.test.ts'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      UPDATE_ARTICLE_FINGERPRINTS: '1',
      ARTICLE_FINGERPRINT_MINOR: minor.join(','),
    },
  },
);
process.exit(result.status ?? 1);
