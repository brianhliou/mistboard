import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('all workspaces declare and resolve the same TypeScript 7 compiler', () => {
  const manifest = read(path.join(root, 'package.json'));
  const lock = read(path.join(root, 'package-lock.json'));
  let expected;
  let installed;
  for (const [directory, pkg] of Object.entries(lock.packages)) {
    const isWorkspace = manifest.workspaces.some((pattern) =>
      directory.startsWith(pattern.replace(/\*$/, '')),
    );
    if (!isWorkspace || directory.includes('node_modules/')) continue;
    const workspace = read(path.join(root, directory, 'package.json'));
    expected ??= workspace.devDependencies.typescript;
    assert.match(expected ?? '', /^\^7\./);
    assert.equal(workspace.devDependencies.typescript, expected, directory);
    assert.equal(pkg.devDependencies.typescript, expected, `lockfile ${directory}`);
    const actual = createRequire(path.join(root, directory, 'package.json'))(
      'typescript/package.json',
    ).version;
    installed ??= actual;
    assert.match(actual, /^7\./);
    assert.equal(
      (
        lock.packages[`${directory}/node_modules/typescript`] ??
        lock.packages['node_modules/typescript']
      ).version,
      actual,
      `locked compiler ${directory}`,
    );
    assert.equal(actual, installed, `${directory} resolves a different compiler`);
  }
});

test('madge analysis tools resolve the TypeScript 5 API they require', () => {
  let entry = path.join(root, 'package.json');
  for (const dependency of [
    'madge',
    'dependency-tree',
    'precinct',
    'detective-typescript',
    '@typescript-eslint/typescript-estree',
    'ts-api-utils',
  ]) {
    entry = createRequire(entry).resolve(dependency);
  }
  const require = createRequire(entry);
  assert.match(require('typescript/package.json').version, /^5\./);
  // TypeScript 7 supplies a compiler binary, not this analysis API. Loading
  // ts-api-utils with it crashes on TypeFlags.Intrinsic before madge can run.
  assert.equal(typeof require('typescript').TypeFlags.Intrinsic, 'number');
  assert.doesNotThrow(() => require(entry));
});
