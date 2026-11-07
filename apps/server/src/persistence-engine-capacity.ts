import type pg from 'pg';
import {
  type EngineAlertEmailPayload,
  type SendEngineAlertEmailResult,
  sendEngineAlertNotification,
} from './engine-alert-email.js';
import { getPool, isInitialized, withTransaction } from './persistence-db.js';

type Queryable = Pick<pg.PoolClient, 'query'>;

export async function recordEnginePoolWaitOn(
  db: Queryable,
  pool: string,
  waitMs: number,
  queueDepth: number,
  now = new Date(),
): Promise<void> {
  await db.query(
    `INSERT INTO engine_pool_wait_days (day, pool, wait_count, max_wait_ms, max_queue_depth)
     VALUES ($1, $2, 1, $3, $4)
     ON CONFLICT (day, pool) DO UPDATE SET
       wait_count = engine_pool_wait_days.wait_count + 1,
       max_wait_ms = GREATEST(engine_pool_wait_days.max_wait_ms, EXCLUDED.max_wait_ms),
       max_queue_depth = GREATEST(engine_pool_wait_days.max_queue_depth, EXCLUDED.max_queue_depth)`,
    [now.toISOString().slice(0, 10), pool, Math.round(waitMs), queueDepth],
  );
}

export async function persistEnginePoolWait(
  pool: string,
  waitMs: number,
  queueDepth: number,
): Promise<boolean> {
  if (!isInitialized()) return false;
  await recordEnginePoolWaitOn(getPool(), pool, waitMs, queueDepth);
  return true;
}

/** Called inside a transaction; serialize deliveries across overlapping ticks
 * and processes. Failed/disabled sends leave the completed day available. */
export async function deliverEnginePoolWaitDigestOn(
  db: Queryable,
  send: (alert: EngineAlertEmailPayload) => Promise<SendEngineAlertEmailResult>,
  now = new Date(),
): Promise<SendEngineAlertEmailResult | null> {
  const lock = await db.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_xact_lock(hashtext('engine-pool-wait-digest')) AS locked`,
  );
  if (!lock.rows[0]?.locked) return null;
  const result = await db.query<{
    day: string;
    pool: string;
    wait_count: number;
    max_wait_ms: number;
    max_queue_depth: number;
  }>(
    `SELECT day::text, pool, wait_count, max_wait_ms, max_queue_depth
     FROM engine_pool_wait_days
     WHERE day = (SELECT min(day) FROM engine_pool_wait_days
                  WHERE day < $1 AND digest_sent_at IS NULL)
     ORDER BY pool`,
    [now.toISOString().slice(0, 10)],
  );
  if (result.rows.length === 0) return null;
  const sent = await send({
    severity: 'warning',
    kind: 'engine_pool_queue_wait',
    day: result.rows[0]!.day,
    window_hours: 24,
    wait_count: result.rows.reduce((sum, row) => sum + row.wait_count, 0),
    pools: result.rows
      .map(
        (row) =>
          `${row.pool}: count=${row.wait_count}, max_wait_ms=${row.max_wait_ms}, max_queue_depth=${row.max_queue_depth}`,
      )
      .join('; '),
  });
  if (sent.status === 'sent') {
    await db.query(`UPDATE engine_pool_wait_days SET digest_sent_at = $2 WHERE day = $1`, [
      result.rows[0]!.day,
      now,
    ]);
    // A month of aggregate history is enough; unsent summaries are never pruned.
    await db.query(
      `DELETE FROM engine_pool_wait_days
                    WHERE day < $1::date - 30 AND digest_sent_at IS NOT NULL`,
      [now.toISOString().slice(0, 10)],
    );
  }
  return sent;
}

/** The digest's sender. It retries every minute until a day is marked sent, and
 * those retries hit the alert throttle; none of them is a suppressed alert. */
export function sendEnginePoolWaitDigest(
  alert: EngineAlertEmailPayload,
): Promise<SendEngineAlertEmailResult> {
  return sendEngineAlertNotification(alert, { countSuppressed: false });
}

export async function deliverEnginePoolWaitDigest(): Promise<SendEngineAlertEmailResult | null> {
  if (!isInitialized()) return null;
  return await withTransaction((db) => deliverEnginePoolWaitDigestOn(db, sendEnginePoolWaitDigest));
}
