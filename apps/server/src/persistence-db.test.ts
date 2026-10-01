import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type pg from 'pg';
import { close, getPool, init } from './persistence-db.js';

// node-postgres re-emits an idle client's socket error on the Pool; with no
// 'error' listener, EventEmitter throws it and Node exits, taking the live
// server and every game in it down. init() must install the guard itself.
test('a pool error from a dropped idle client is logged, never thrown', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  // pg connects lazily: no query runs, so nothing listens on this port.
  init('postgres://mistboard@127.0.0.1:9/never');
  try {
    const pool = getPool();
    const dropped = Object.assign(
      new Error('terminating connection due to administrator command'),
      {
        client: { connectionParameters: { password: 'secret' } },
      },
    );
    assert.doesNotThrow(() => pool.emit('error', dropped));

    // A checked-out client has no pool listener between queries; the guard
    // gives it one as it connects.
    const client = new EventEmitter() as unknown as pg.PoolClient;
    pool.emit('connect', client);
    assert.doesNotThrow(() =>
      client.emit('error', new Error('Connection terminated unexpectedly')),
    );
    // An idle client's drop reaches its own listener and the pool's with one
    // error object (pg-pool's idle listener re-emits it): one line, not two.
    const idleDrop = new Error('terminating connection due to administrator command');
    client.emit('error', idleDrop);
    pool.emit('error', idleDrop);
    await new Promise((resolve) => setImmediate(resolve));

    const lines = warn.mock.calls.map((call) => String(call.arguments[0]));
    assert.equal(lines.length, 3);
    // Pool lines log at once; the client line waits a microtask.
    assert.match(lines[0]!, /idle connection closed \(terminating connection/);
    assert.match(lines[1]!, /idle connection closed \(terminating connection/);
    assert.match(lines[2]!, /checked-out client \(Connection terminated unexpectedly\)/);
    for (const line of lines) assert.doesNotMatch(line, /secret|127\.0\.0\.1|postgres:\/\//);
  } finally {
    await close();
  }
});
