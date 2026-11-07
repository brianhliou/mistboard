import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseArgs, tunnelChildEnv, tunnelDatabaseUrl } from './prod-db.mjs';

const PG = { PGUSER: 'postgres', PGPASSWORD: 'p@ss:w/rd#1', PGDATABASE: 'railway' };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./prod-db.mjs', import.meta.url));
const READ_ONLY = '-c default_transaction_read_only=on';

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

test('--read-only is a wrapper flag and survives the inner call', () => {
  assert.deepEqual(parseArgs(['--read-only', 'node', 'x.mjs']), {
    inner: false,
    readOnly: true,
    command: ['node', 'x.mjs'],
  });
  assert.deepEqual(parseArgs(['--read-only', '--', 'node', 'x.mjs']), {
    inner: false,
    readOnly: true,
    command: ['node', 'x.mjs'],
  });
  assert.deepEqual(parseArgs(['--read-only', '--inner', '5', '/w', '--', 'node', 'x.mjs']), {
    inner: true,
    readOnly: true,
    port: 5,
    cwd: '/w',
    command: ['node', 'x.mjs'],
  });
  assert.deepEqual(parseArgs(['node', 'x.mjs', '--read-only']), {
    inner: false,
    command: ['node', 'x.mjs', '--read-only'],
  });
  assert.deepEqual(parseArgs(['--read-only']), { inner: false, readOnly: true, command: [] });
});

test('read-only appends the database default after inherited options without changing the parent', () => {
  const inherited = '-c statement_timeout=1234 -c default_transaction_read_only=off';
  const env = { ...PG, PGOPTIONS: inherited };
  assert.equal(tunnelChildEnv(env, 54399, true).PGOPTIONS, `${inherited} ${READ_ONLY}`);
  assert.equal(tunnelChildEnv(PG, 54399, true).PGOPTIONS, READ_ONLY);
  assert.equal(env.PGOPTIONS, inherited);
  assert.equal(tunnelChildEnv(env, 54399).PGOPTIONS, inherited);
  assert.equal(Object.hasOwn(tunnelChildEnv(PG, 54399), 'PGOPTIONS'), false);
});

for (const readOnly of [false, true]) {
  test(`the real wrapper forwards readOnly=${readOnly} through Railway to pg's startup options`, () => {
    // Stub only Railway and the tunnel. The inner wrapper and installed pg
    // driver run in real child processes with fixture-only environments.
    const inherited = '-c statement_timeout=1234 -c default_transaction_read_only=off';
    const child = `
      const assert = require('node:assert/strict');
      const pg = require('pg');
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      assert.equal(client.getStartupConf().options, ${JSON.stringify(readOnly ? `${inherited} ${READ_ONLY}` : inherited)});
      assert.equal(client.connectionParameters.host, '127.0.0.1');
      assert.equal(client.connectionParameters.port, 54399);
    `;
    const harness = `
      import assert from 'node:assert/strict';
      import cp from 'node:child_process';
      import { EventEmitter } from 'node:events';
      import { syncBuiltinESMExports } from 'node:module';
      import net from 'node:net';
      import { pathToFileURL } from 'node:url';
      const spawn = cp.spawn;
      const tunnel = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null });
      cp.execFileSync = (command) => {
        if (command === 'git') return ${JSON.stringify(ROOT)};
        if (command === 'pgrep') return '';
        throw new Error('unexpected command');
      };
      cp.spawn = (command, args, options) => {
        assert.equal(command, 'railway');
        if (args[0] === 'connect') return tunnel;
        assert.deepEqual(args.slice(0, 4), ['run', '-s', 'Postgres', '--']);
        return spawn(args[4], args.slice(5), { ...options, env: ${JSON.stringify({ ...PG, PGOPTIONS: inherited })} });
      };
      net.createServer = () => Object.assign(new EventEmitter(), {
        listen(_port, _host, callback) { queueMicrotask(callback); },
        address() { return { port: 54399 }; },
        close(callback) { callback(); },
      });
      net.connect = () => {
        const socket = Object.assign(new EventEmitter(), { destroy() {} });
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      };
      process.kill = (pid, signal) => {
        assert.equal(pid, tunnel.pid);
        assert.equal(signal, 'SIGTERM');
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, ${JSON.stringify(SCRIPT)}, ...${JSON.stringify([
        ...(readOnly ? ['--read-only'] : []),
        process.execPath,
        '-e',
        child,
      ])}];
      await import(pathToFileURL(${JSON.stringify(SCRIPT)}).href);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', harness], {
      cwd: ROOT,
      env: {},
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
  });
}

test('local Postgres rejects the planted INSERT only with --read-only; blind spot: SET or BEGIN READ WRITE overrides the default', {
  skip: process.env.MISTBOARD_TEST_PROD_DB_LOCAL !== '1',
  timeout: 30_000,
}, async () => {
  // Explicit opt-in, fixed localhost test DB, no Railway or inherited URL.
  // Use a regular table: Postgres permits temporary-table writes in read-only transactions.
  const local = { PGUSER: 'mistboard', PGPASSWORD: 'mistboard', PGDATABASE: 'mistboard_test' };
  const client = new pg.Client({
    connectionString: tunnelDatabaseUrl(local, 5435),
    ssl: false,
    options: '-c default_transaction_read_only=off',
    connectionTimeoutMillis: 2000,
  });
  const table = `public.prod_db_read_only_${randomUUID().replaceAll('-', '')}`;
  const insert = `INSERT INTO ${table} (value) VALUES (1)`;
  const attempt = (readOnly, override = '') => {
    const code = `
        const pg = require('pg');
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 2000 });
        (async () => {
          try {
            await client.connect();
            if (${JSON.stringify(override)}) await client.query(${JSON.stringify(override)});
            await client.query(${JSON.stringify(insert)});
            if (${JSON.stringify(override)} === 'BEGIN READ WRITE') await client.query('COMMIT');
          } catch (error) {
            console.error(error.code ?? 'unexpected database error');
            process.exitCode = 1;
          } finally {
            await client.end();
          }
        })();
      `;
    return spawnSync(
      process.execPath,
      [
        SCRIPT,
        ...(readOnly ? ['--read-only'] : []),
        '--inner',
        '5435',
        ROOT,
        '--',
        process.execPath,
        '-e',
        code,
      ],
      { cwd: ROOT, env: local, encoding: 'utf8', timeout: 10_000 },
    );
  };
  let created = false;
  try {
    await client.connect();
    await client.query(`CREATE TABLE ${table} (value integer)`);
    created = true;
    const denied = attempt(true);
    assert.equal(denied.status, 1, denied.stderr);
    assert.match(denied.stderr, /\b25006\b/, 'Postgres must reject the INSERT as read-only');
    assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount, 0);

    const allowed = attempt(false);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount, 1);

    // This is an accidental-write guard, not an authorization boundary.
    for (const override of ['SET default_transaction_read_only=off', 'BEGIN READ WRITE']) {
      const bypass = attempt(true, override);
      assert.equal(bypass.status, 0, bypass.stderr);
    }
    assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount, 3);
  } finally {
    try {
      if (created) await client.query(`DROP TABLE ${table}`);
    } finally {
      await client.end();
    }
  }
});
