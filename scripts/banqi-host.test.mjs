// Lightweight hosting checks join the tooling gate; Docker stays opt-in.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('standalone Banqi host security, model and context checks', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-reporter=tap', 'services/banqi-provider/host.test.mjs'],
    { cwd: resolve(import.meta.dirname, '..'), env, encoding: 'utf8', timeout: 20000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /# tests [1-9][0-9]*/, 'the child must execute the host tests');
});
