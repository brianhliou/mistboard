import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('root and all workspaces declare and resolve the same TypeScript 7 compiler', () => {
  const manifest = read(path.join(root, 'package.json'));
  const lock = read(path.join(root, 'package-lock.json'));
  const expected = manifest.devDependencies.typescript;
  assert.match(expected ?? '', /^\^7\./, 'root must declare TypeScript 7');
  assert.equal(lock.packages[''].devDependencies.typescript, expected);
  const installed = createRequire(path.join(root, 'package.json'))(
    'typescript/package.json',
  ).version;
  assert.match(installed, /^7\./);
  assert.equal(lock.packages['node_modules/typescript'].version, installed);
  for (const [directory, pkg] of Object.entries(lock.packages)) {
    const isWorkspace = manifest.workspaces.some((pattern) =>
      directory.startsWith(pattern.replace(/\*$/, '')),
    );
    if (!isWorkspace || directory.includes('node_modules/')) continue;
    const workspace = read(path.join(root, directory, 'package.json'));
    assert.equal(workspace.devDependencies.typescript, expected, directory);
    assert.equal(pkg.devDependencies.typescript, expected, `lockfile ${directory}`);
    assert.equal(
      lock.packages[`${directory}/node_modules/typescript`]?.version ?? installed,
      installed,
      `locked compiler ${directory}`,
    );
    const actual = createRequire(path.join(root, directory, 'package.json'))(
      'typescript/package.json',
    ).version;
    assert.equal(actual, installed, `${directory} resolves a different compiler`);
  }
});
