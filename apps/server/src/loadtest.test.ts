import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Load tooling lives outside the production compiler's src root. Run its typed
// suite through tsx from both source and compiled server test runners.
test('loadtest: acknowledgment and local benchmark regression suite', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--test',
      fileURLToPath(new URL('../loadtest/runner.test.ts', import.meta.url)),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
});
