import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import test from 'node:test';
import { createWorkerPool, isWorkerDbConnectionError } from './worker-db.js';

// A tiny PostgreSQL peer over an in-memory socket: the real pg Client parses
// startup/query responses and handles socket destruction. No database or TCP
// listener is needed, and pg-pool still owns client eviction and reconnects.
class PostgresSocket extends Duplex {
  private started = false;
  dropOnQuery = false;

  connect(): this {
    queueMicrotask(() => this.emit('connect'));
    return this;
  }

  setNoDelay(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  override _read(): void {}

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    if (!this.started) {
      this.started = true;
      // AuthenticationOk, then ReadyForQuery (idle).
      queueMicrotask(() =>
        this.push(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73])),
      );
    } else if (chunk[0] === 81) {
      if (this.dropOnQuery) {
        queueMicrotask(() =>
          this.destroy(
            Object.assign(new Error('Connection reset by peer'), { code: 'ECONNRESET' }),
          ),
        );
        callback();
        return;
      }
      // CommandComplete (SELECT 0), then ReadyForQuery.
      queueMicrotask(() => {
        this.push(Buffer.from([67, 0, 0, 0, 13, ...Buffer.from('SELECT 0\0')]));
        this.push(Buffer.from([90, 0, 0, 0, 5, 73]));
      });
    } else if (chunk[0] === 88) {
      this.push(null);
    }
    callback();
  }

  override _final(callback: () => void): void {
    this.push(null);
    callback();
  }
}

function createTestPool() {
  const sockets: PostgresSocket[] = [];
  const pool = createWorkerPool({
    host: 'worker-db.test',
    user: 'worker-test',
    database: 'worker-test',
    ssl: false,
    stream: () => {
      const socket = new PostgresSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { pool, sockets };
}

test('worker pool survives an idle socket drop and the next task query reconnects', {
  timeout: 5_000,
}, async (t) => {
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const { pool, sockets } = createTestPool();
  try {
    const taskQuery = "SELECT id FROM engine_game_tasks WHERE status = 'queued'";
    assert.deepEqual((await pool.query(taskQuery)).rows, []);
    assert.equal(pool.idleCount, 1);
    const dropped = sockets[0]!;
    const closed = new Promise<void>((resolve) => dropped.once('close', resolve));
    dropped.destroy(Object.assign(new Error('Connection reset by peer'), { code: 'ECONNRESET' }));
    await closed;
    assert.equal(pool.totalCount, 0, 'the dead client is evicted');
    assert.deepEqual((await pool.query(taskQuery)).rows, []);
    assert.equal(sockets.length, 2, 'the next task query opens a fresh connection');
    const lines = warnings.mock.calls.map((call) => String(call.arguments[0]));
    assert.equal(lines.length, 1, 'one warning per dropped connection');
    assert.match(lines[0]!, /idle connection closed/);
    assert.doesNotMatch(lines[0]!, /worker-db.test|worker-test/);
  } finally {
    await pool.end();
  }
});

test('worker pool rejects a query interrupted by a socket drop and reconnects', {
  timeout: 5_000,
}, async (t) => {
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const { pool, sockets } = createTestPool();
  try {
    await pool.query('SELECT 1');
    sockets[0]!.dropOnQuery = true;
    await assert.rejects(pool.query('SELECT 1'), (error: unknown) => {
      assert.equal(isWorkerDbConnectionError(error), true, 'polling may retry this rejection');
      return true;
    });
    assert.deepEqual((await pool.query('SELECT 1')).rows, []);
    assert.equal(sockets.length, 2);
    assert.equal(warnings.mock.calls.length, 1);
    assert.match(String(warnings.mock.calls[0]!.arguments[0]), /checked-out client/);
  } finally {
    await pool.end();
  }
});

test('worker polling recognizes connection failures but not SQL or task errors', () => {
  for (const code of [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    '08006',
    '57P01',
    '57P02',
    '57P03',
  ]) {
    assert.equal(
      isWorkerDbConnectionError(Object.assign(new Error('database unavailable'), { code })),
      true,
      code,
    );
  }
  assert.equal(isWorkerDbConnectionError(new Error('Connection terminated unexpectedly')), true);
  for (const error of [
    new Error('engine failed'),
    Object.assign(new Error('syntax error'), { code: '42601' }),
    Object.assign(new Error('authentication failed'), { code: '28P01' }),
    null,
  ]) {
    assert.equal(isWorkerDbConnectionError(error), false);
  }
});
