#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { DEFAULT_TEST_DATABASE_URL, ensureTestDatabase } from './ensure-test-database.mjs';

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const usingDefaultLocalTestDatabase = process.env.TEST_DATABASE_URL === undefined;

if (usingDefaultLocalTestDatabase) {
  await ensureTestDatabase({ databaseUrl: testDatabaseUrl });
}

const result = spawnSync('npm', ['run', 'test:persistent', '--workspace', '@mistboard/server'], {
  env: {
    ...process.env,
    TEST_DATABASE_URL: testDatabaseUrl,
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) {
  console.error(`persistent tests exited with signal ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
