// Which changes need the Postgres-backed suite, and whether we can run it here.
//
// `test:persistent` is not in `ci:quick`, so hosted CI is the only place it runs
// by default. That makes it the one gate a local check can miss, and missing it
// lands red on main, which silently freezes the Railway auto-deploy.
//
// Two callers share this: the pre-push hook (scripts/pre-push-check.mjs) and the
// release script (scripts/release-prod.mjs). They must agree on what counts as a
// persistence change, because release:prod pushes with --no-verify and so never
// reaches the hook. On 2026-08-27 only the hook knew, the release skipped it, and
// three persistent tests went red on main.

import net from 'node:net';

export { DEFAULT_TEST_DATABASE_URL } from './test-database-url.mjs';

// Migrations and the persistence modules themselves. Deliberately narrow: a
// wider net would run a 90-second suite on most pushes and get skipped by hand.
export function isPersistenceWatchedPath(file) {
  return (
    file.startsWith('apps/server/migrations/') ||
    file === 'apps/server/src/migrate.ts' ||
    /^apps\/server\/src\/persistence[^/]*\.ts$/.test(file)
  );
}

export function needsPersistenceGate(files) {
  return files.some(isPersistenceWatchedPath);
}

export function persistenceGateWarning(label) {
  return `
${label}: ==================== WARNING ====================
${label}: persistence/migration files changed, but Postgres-backed tests
${label}: (test:persistent) only run in hosted CI. A query/migration bug in
${label}: this push can land red on main and silently freeze the Railway
${label}: auto-deploy. To check locally before pushing:
${label}:   npm run db:up && npm run test:persistent
${label}: =================================================
`;
}

export function isDatabaseReachable(databaseUrl) {
  let host = 'localhost';
  let port = 5432;
  try {
    const parsed = new URL(databaseUrl);
    host = parsed.hostname || host;
    port = Number(parsed.port) || port;
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1000 });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
