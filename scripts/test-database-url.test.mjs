import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { DEFAULT_TEST_DATABASE_URL, testDatabaseName } from './test-database-url.mjs';

test('the same worktree always gets the same database name', () => {
  const root = '/projects/mistboard-task';
  const expected = testDatabaseName(root);
  for (let i = 0; i < 10; i += 1) assert.equal(testDatabaseName(root), expected);
});

test('different worktrees get different names, including roots with the same basename', () => {
  const roots = ['/projects/mistboard', '/projects/mistboard-task', '/other/mistboard'];
  assert.equal(new Set(roots.map(testDatabaseName)).size, roots.length);
});

test('equivalent paths produce the same name', () => {
  assert.equal(
    testDatabaseName('/projects/mistboard/../mistboard-task/'),
    testDatabaseName('/projects/mistboard-task'),
  );
});

test('names are safe Postgres identifiers below the 63-byte limit', () => {
  const name = testDatabaseName(`/projects/${'long worktree "名字"/'.repeat(20)}`);
  assert.match(name, /^mistboard_test_[a-f0-9]{12}$/);
  assert.ok(Buffer.byteLength(name) <= 63);
});

test('the default URL names the module checkout on the shared local Postgres', () => {
  const root = resolve(import.meta.dirname, '..');
  const url = new URL(DEFAULT_TEST_DATABASE_URL);
  assert.equal(url.pathname, `/${testDatabaseName(root)}`);
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5435');
});
