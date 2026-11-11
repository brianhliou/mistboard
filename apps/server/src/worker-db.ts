import pg from 'pg';
import { guardPoolConnectionErrors } from './persistence-db.js';

export function createWorkerPool(config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool({ ...config, max: 4 });
  guardPoolConnectionErrors(pool);
  return pool;
}

// Retry only connection failures in the queue poll, never SQL mistakes or an
// engine task itself: a connection loss can leave a task's writes ambiguous.
export function isWorkerDbConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (code !== undefined &&
      (/^08[A-Z0-9]{3}$/.test(code) ||
        [
          '57P01',
          '57P02',
          '57P03',
          'ECONNRESET',
          'ECONNREFUSED',
          'ETIMEDOUT',
          'EPIPE',
          'EHOSTUNREACH',
          'ENETUNREACH',
        ].includes(code))) ||
    /^(Connection terminated(?: unexpectedly)?|Client has encountered a connection error and is not queryable)$/.test(
      error.message,
    )
  );
}
