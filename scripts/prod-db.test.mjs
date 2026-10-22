import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, tunnelChildEnv, tunnelDatabaseUrl } from './prod-db.mjs';

const PG = { PGUSER: 'postgres', PGPASSWORD: 'p@ss:w/rd#1', PGDATABASE: 'railway' };

test('the tunnel URL points at localhost and encodes the password', () => {
  const url = new URL(tunnelDatabaseUrl(PG, 54399));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '54399');
  assert.equal(decodeURIComponent(url.password), PG.PGPASSWORD);
  assert.equal(url.pathname, '/railway');
});

test('the child gets both database variables and loses the internal host', () => {
  const env = tunnelChildEnv(
    {
      ...PG,
      DATABASE_URL: 'postgresql://x@postgres.railway.internal:5432/railway',
      PGHOST: 'postgres.railway.internal',
    },
    54399,
  );
  assert.equal(env.DATABASE_URL, env.DATABASE_PUBLIC_URL);
  assert.match(env.DATABASE_URL, /@127\.0\.0\.1:54399\//);
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGPORT, '54399');
});

test('a missing service variable is named, and the password never appears in the error', () => {
  const { PGDATABASE: _omit, ...partial } = PG;
  assert.throws(
    () => tunnelDatabaseUrl(partial, 1),
    (error) => /PGDATABASE/.test(error.message) && !error.message.includes(PG.PGPASSWORD),
  );
});

test('arguments: plain command, leading --, and the inner call', () => {
  assert.deepEqual(parseArgs(['node', 'x.mjs']), { inner: false, command: ['node', 'x.mjs'] });
  assert.deepEqual(parseArgs(['--', 'node', 'x.mjs']), {
    inner: false,
    command: ['node', 'x.mjs'],
  });
  assert.deepEqual(parseArgs(['--inner', '5', '/w', '--', 'npm', 'run', 'a', '--', '--b']), {
    inner: true,
    port: 5,
    cwd: '/w',
    command: ['npm', 'run', 'a', '--', '--b'],
  });
  assert.throws(() => parseArgs(['--inner', '5', '/w', 'npm']), /malformed/);
});
