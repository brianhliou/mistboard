const LOCAL_DEV_DATABASE_URL = {
  database: 'mistboard',
  hostnames: new Set(['localhost', '127.0.0.1', '[::1]']),
  port: '5435',
  username: 'mistboard',
};

export function testDatabaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? '';
  if (!url) return '';
  assertSafePersistentTestDatabaseUrl(url, env);
  return url;
}

export function assertSafePersistentTestDatabaseUrl(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.MISTBOARD_ALLOW_DEV_DB_TESTS === '1') return;
  if (!isLocalDevDatabaseUrl(value)) return;
  throw new Error(
    [
      'Refusing to run persistent tests against the local dev database.',
      'Use `npm run test:persistent`, which defaults to a per-worktree mistboard_test_<hash> database,',
      'or set MISTBOARD_ALLOW_DEV_DB_TESTS=1 if you intentionally want to truncate mistboard.',
    ].join(' '),
  );
}

function isLocalDevDatabaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const port = parsed.port || '5432';
  return (
    parsed.protocol.startsWith('postgres') &&
    LOCAL_DEV_DATABASE_URL.hostnames.has(parsed.hostname) &&
    port === LOCAL_DEV_DATABASE_URL.port &&
    parsed.username === LOCAL_DEV_DATABASE_URL.username &&
    database === LOCAL_DEV_DATABASE_URL.database
  );
}
