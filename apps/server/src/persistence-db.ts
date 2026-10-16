import pg from 'pg';

let pool: pg.Pool | null = null;

// Per-session resource ceilings for batch workers. A long-running fleet
// hammering one query deserves a blast radius; the live server wants neither of
// these, so they are opt-in rather than a default.
//
// On 2026-08-22 eight mining workers ran a query that spilled 45GB of temp
// files and filled the production volume. Either limit alone would have turned
// that into aborted queries instead of an incident. See memory
// ops_mining_fanout_disk_full.
export type PoolSessionGuards = {
  statementTimeoutMs?: number;
  tempFileLimitKb?: number;
  // Pool ceiling per process. The default suits one long-lived server; a fleet
  // of N short-lived workers multiplies it by N against a fixed
  // max_connections that the LIVE site also draws from. A worker that processes
  // its unit sequentially needs one or two, so scaling the fleet safely means
  // shrinking this first.
  maxPoolConnections?: number;
};

export function init(connectionString: string, guards?: PoolSessionGuards): void {
  if (pool) throw new Error('persistence already initialized');
  // Both limits ride libpq's `options`, so the server applies them while the
  // session starts. Setting them from a pool 'connect' handler instead would
  // queue the SET behind whatever query triggered the new connection, leaving
  // that first query — the one most likely to be the runaway — unguarded.
  //
  // temp_file_limit is superuser-only on some deployments. Failing the
  // connection outright is the right behaviour: a batch fleet that cannot
  // install its ceiling should refuse to start rather than run uncapped.
  const settings: string[] = [];
  if (guards?.statementTimeoutMs !== undefined) {
    settings.push(`-c statement_timeout=${Math.trunc(guards.statementTimeoutMs)}`);
  }
  if (guards?.tempFileLimitKb !== undefined) {
    settings.push(`-c temp_file_limit=${Math.trunc(guards.tempFileLimitKb)}`);
  }
  pool = new pg.Pool({
    connectionString,
    max: guards?.maxPoolConnections ?? 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ...(settings.length === 0 ? {} : { options: settings.join(' ') }),
  });
  guardPoolConnectionErrors(pool);
}

/**
 * Keep a dropped connection from killing the process. pg-pool re-emits an idle
 * client's socket error on the Pool (with the whole Client attached as
 * `err.client`), and a Pool with no 'error' listener turns that into an
 * uncaught exception: the live server exits and every game in it ends. The pool
 * has already discarded that client; the next query connects afresh.
 *
 * A checked-out client (withTransaction, pool.connect() callers) has no
 * listener of its own between queries either, so it gets one as it connects;
 * the query it was running still rejects to its caller. Only `err.message` is
 * logged: never the client, which carries the connection parameters.
 *
 * The client listener stays on through idle spells too, so an idle drop reaches
 * both listeners with the same error; the client one waits a microtask and
 * stays quiet when the pool one has logged it, so each drop is one line.
 *
 * init() installs this on every pool. Returns the detach function.
 */
export function guardPoolConnectionErrors(
  target: pg.Pool,
  warn: (message: string) => void = (message) => console.warn(message),
): () => void {
  const loggedByPool = new WeakSet<Error>();
  const onPoolError = (err: Error) => {
    loggedByPool.add(err);
    warn(`[db] pool: idle connection closed (${err.message}); the next query reconnects`);
  };
  const onClientError = (err: Error) => {
    queueMicrotask(() => {
      if (loggedByPool.has(err)) return;
      warn(`[db] pool: connection error on a checked-out client (${err.message})`);
    });
  };
  const onConnect = (client: pg.PoolClient) => client.on('error', onClientError);
  target.on('error', onPoolError);
  target.on('connect', onConnect);
  return () => {
    target.off('error', onPoolError);
    target.off('connect', onConnect);
  };
}

export async function probeDb(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function close(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

export function isInitialized(): boolean {
  return pool !== null;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('persistence not initialized — call init(connectionString) first');
  return pool;
}

// Run `fn` inside a single BEGIN/COMMIT transaction on a dedicated pooled
// client. Commits when `fn` resolves, rolls back when it throws (the ROLLBACK
// is itself guarded so a rollback failure can't mask the original error), and
// always releases the client. Read-only early returns are safe to commit.
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Run `fn` inside a transaction that ALWAYS rolls back, whether `fn` resolves
// or throws. This is the dry-run boundary: callers exercise the exact same
// write path (inserts, upserts, sync logs) and observe its results, but none
// of it commits.
export async function withRollbackTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
