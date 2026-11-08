import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Anchor to this checkout, not cwd: callers also run from apps/server.
const REPO_ROOT = resolve(import.meta.dirname, '..');

export function testDatabaseName(repoRoot) {
  const hash = createHash('sha256').update(resolve(repoRoot)).digest('hex').slice(0, 12);
  return `mistboard_test_${hash}`;
}

export const DEFAULT_TEST_DATABASE_URL = `postgres://mistboard:mistboard@localhost:5435/${testDatabaseName(REPO_ROOT)}`;
