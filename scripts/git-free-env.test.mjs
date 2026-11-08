import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gitFreeEnv } from './lib/git-free-env.mjs';

function decoyAndScratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mistboard-git-free-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const decoy = join(directory, 'decoy');
  const scratch = join(directory, 'scratch');
  mkdirSync(decoy);
  mkdirSync(scratch);
  const clean = gitFreeEnv();
  assert.equal(spawnSync('git', ['init', '-q', decoy], { env: clean }).status, 0);
  // What a hook hands its children: GIT_DIR naming the real repo.
  const hookEnv = { ...process.env, GIT_DIR: join(decoy, '.git') };
  const decoyConfig = () => readFileSync(join(decoy, '.git', 'config'), 'utf8');
  return { decoy, scratch, hookEnv, decoyConfig };
}

const initAndConfigure = (cwd, env) => {
  spawnSync('git', ['init', '-q'], { cwd, env });
  spawnSync('git', ['config', 'user.name', 'Leak probe'], { cwd, env });
};

test('planted: a fixture spawning git with the hook env writes into the hook repo', (t) => {
  const { scratch, hookEnv, decoyConfig } = decoyAndScratch(t);
  initAndConfigure(scratch, hookEnv);
  // The hazard is real: the scratch repo was never created, the decoy took the write.
  assert.match(decoyConfig(), /Leak probe/);
  assert.equal(existsSync(join(scratch, '.git')), false);
});

test('gitFreeEnv keeps a fixture git inside its scratch repo', (t) => {
  const { scratch, hookEnv, decoyConfig } = decoyAndScratch(t);
  const before = decoyConfig();
  initAndConfigure(scratch, gitFreeEnv(hookEnv));
  assert.equal(decoyConfig(), before);
  assert.match(readFileSync(join(scratch, '.git', 'config'), 'utf8'), /Leak probe/);
});

test('gitFreeEnv drops every GIT_ variable and keeps the rest', () => {
  const env = gitFreeEnv({ GIT_DIR: 'a', GIT_INDEX_FILE: 'b', GIT_WORK_TREE: 'c', PATH: 'p' });
  assert.deepEqual(env, { PATH: 'p' });
});
