import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { close, getPool, init } from './persistence-db.js';
import './variant-tenant/register-tenants.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';

// Only metadata leaves this command. Never select/log event payloads, board
// setups, token hashes, client ids, emails or account ids in the report.
// Rooms come from the event log, not from games: xiangqi, jieqi, banqi, Jungle
// and fog xiangqi write their games row only at game end, so a running game of
// theirs has none. A room with a games row must still be a running PvP game.
export const MISSING_DEADLINE_SQL = `SELECT created.room_id,
       COALESCE(g.variant, created.payload->>'gameSpecId') AS variant,
       g.started_at, created.created_at AS room_created_at,
       (created.payload->'timeControl'->>'daysPerMove')::double precision AS days_per_move,
       (SELECT count(*)::int FROM events e WHERE e.room_id = created.room_id) AS event_count,
       (SELECT max(seq) FROM events e WHERE e.room_id = created.room_id) AS last_seq,
       (SELECT count(*)::int FROM events e
          WHERE e.room_id = created.room_id AND e.type = 'seat-assigned') AS seat_events,
       (SELECT count(*)::int FROM room_seat_tokens t
          WHERE t.room_id = created.room_id AND t.revoked_at IS NULL) AS reserved_seats,
       (SELECT max(issued_at) FROM room_seat_tokens t
          WHERE t.room_id = created.room_id AND t.revoked_at IS NULL) AS last_reservation_at,
       (SELECT CASE WHEN o.target_user_id IS NOT NULL THEN 'directed-challenge-accept'
                    WHEN o.visibility = 'public' THEN 'public-seek-accept (includes quick-pair)'
                    ELSE 'private-link-accept' END
          FROM correspondence_seek_outcomes o
          WHERE o.room_id = created.room_id AND o.outcome = 'taken' LIMIT 1) AS accepted_path
FROM events created
LEFT JOIN games g ON g.room_id = created.room_id
WHERE created.seq = 0 AND created.type = 'room-created'
  AND (g.room_id IS NULL OR (g.status = 'running' AND g.mode = 'pvp'))
  AND (created.payload->'timeControl'->>'daysPerMove')::double precision > 0
  AND ($1::text[] IS NULL OR created.room_id = ANY($1))
  AND NOT EXISTS (SELECT 1 FROM room_deadlines rd WHERE rd.room_id = created.room_id)
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.room_id = created.room_id
    AND e.type IN ('move-played', 'game-aborted', 'seat-resigned', 'seat-forfeited',
                   'clock-expired', 'game-adjudicated', 'draw-agreed'))
ORDER BY created.created_at, created.room_id`;

type Candidate = {
  room_id: string;
  variant: string;
  started_at: Date | null;
  room_created_at: Date;
  days_per_move: number;
  event_count: number;
  last_seq: number;
  seat_events: number;
  reserved_seats: number;
  last_reservation_at: Date | null;
  accepted_path: string | null;
};

type Inspection = {
  eventCount: number;
  deadline: { seat: string; dueAt: number } | null;
};

export type RepairOptions = {
  action: 'inspect' | 'backfill' | 'abort';
  roomIds: string[];
  inspectRoom: (roomId: string, specId: string) => Promise<Inspection | null>;
  print: (report: Record<string, unknown>) => void;
  now?: () => number;
};

export async function repairCorrespondenceDeadlines(
  database: Pick<pg.PoolClient, 'query'>,
  options: RepairOptions,
): Promise<void> {
  if (options.action !== 'inspect' && options.roomIds.length === 0)
    throw new Error('writes require explicit room ids');
  await database.query(
    `BEGIN ISOLATION LEVEL SERIALIZABLE${options.action === 'inspect' ? ' READ ONLY' : ''}`,
  );
  try {
    // The predicate reads and index write share a serializable snapshot. A
    // concurrent move/seat/deadline writer must serialize or roll this back;
    // never retry a stale inspection automatically.
    const { rows } = await database.query<Candidate>(MISSING_DEADLINE_SQL, [
      options.roomIds.length ? options.roomIds : null,
    ]);
    for (const id of options.roomIds) {
      if (!rows.some((row) => row.room_id === id))
        throw new Error('selected room is no longer a zero-ply missing-deadline candidate');
    }
    const reports: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (row.last_seq + 1 !== row.event_count) throw new Error('noncontiguous event log');
      const inspected = await options.inspectRoom(row.room_id, row.variant);
      const replayed = inspected !== null && inspected.eventCount === row.event_count;
      // A read-only scan reports a room it cannot replay (a variant without the
      // tenant deadline hook, such as dark chess) and keeps going; a write refuses.
      if (!replayed && options.action !== 'inspect')
        throw new Error('room changed or cannot be replayed; inspect again');
      const deadline = replayed ? inspected.deadline : null;
      let result = !replayed
        ? 'cannot-replay'
        : deadline
          ? 'deadline-can-be-backfilled'
          : 'no-enforceable-deadline';
      if (options.action === 'backfill') {
        if (!deadline) throw new Error('no deadline in event log; cannot invent a first mover');
        const inserted = await database.query(
          `INSERT INTO room_deadlines (room_id, game_spec_id, seat, seat_user_id, due_at)
           SELECT $1, $2, $3, t.user_id, $4::timestamptz
           FROM (SELECT 1) one LEFT JOIN room_seat_tokens t
             ON t.room_id = $1 AND t.seat = $3 AND t.revoked_at IS NULL
           ON CONFLICT (room_id) DO NOTHING`,
          [row.room_id, row.variant, deadline.seat, new Date(deadline.dueAt)],
        );
        if (inserted.rowCount !== 1) throw new Error('deadline changed; inspect again');
        result = 'backfilled';
      } else if (options.action === 'abort') {
        const at = (options.now ?? Date.now)();
        await database.query(
          'INSERT INTO events (room_id, seq, type, payload) VALUES ($1, $2, $3, $4)',
          [
            row.room_id,
            row.event_count,
            'game-aborted',
            {
              type: 'game-aborted',
              roomId: row.room_id,
              at,
              reason: 'user-abort',
            },
          ],
        );
        // A no-op for variants whose games row is written only at game end.
        await database.query(
          `UPDATE games SET status = 'aborted', result = NULL, termination = 'abandoned',
             ended_at = $2, aborted_reason = 'missing-correspondence-deadline'
           WHERE room_id = $1 AND status = 'running'`,
          [row.room_id, new Date(at)],
        );
        result = 'aborted';
      }
      reports.push({
        roomId: row.room_id,
        variant: row.variant,
        createdAt: row.room_created_at,
        startedAt: row.started_at,
        daysPerMove: row.days_per_move,
        seatEvents: row.seat_events,
        reservedSeats: row.reserved_seats,
        lastReservationAt: row.last_reservation_at,
        creationPath:
          row.accepted_path ??
          (row.reserved_seats === 2 && row.seat_events < 2
            ? 'reserved-seats-without-events (consistent with rematch; unproven)'
            : 'invite-or-unrecorded-path'),
        deadline: deadline ? { seat: deadline.seat, dueAt: new Date(deadline.dueAt) } : null,
        result,
      });
    }
    await database.query('COMMIT');
    // Do not claim repairs that a later room's validation or COMMIT rolled back.
    for (const report of reports) options.print(report);
  } catch (err) {
    await database.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

export function parseRepairArgs(args: string[]): Pick<RepairOptions, 'action' | 'roomIds'> {
  let action: RepairOptions['action'] = 'inspect';
  const roomIds: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--backfill' || arg === '--abort') && action === 'inspect') {
      action = arg === '--backfill' ? 'backfill' : 'abort';
    } else if (arg === '--room' && args[i + 1] && !args[i + 1]!.startsWith('--')) {
      roomIds.push(args[++i]!);
    } else throw new Error('usage: [--backfill | --abort] [--room <id>]...');
  }
  if (action !== 'inspect' && roomIds.length === 0) throw new Error('writes require --room');
  return { action, roomIds: [...new Set(roomIds)] };
}

export function redactedError(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')}`;
}

async function main(): Promise<void> {
  const options = parseRepairArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  init(process.env.DATABASE_URL, { maxPoolConnections: 2, statementTimeoutMs: 30_000 });
  const client = await getPool().connect();
  try {
    await repairCorrespondenceDeadlines(client, {
      ...options,
      inspectRoom: async (roomId, specId) => {
        const registration = correspondenceTenantForSpecId(specId);
        if (!registration?.correspondenceDeadline) return null;
        const room = await registration.getOrLoadRoom(roomId);
        if (!room?.events) return null;
        return {
          eventCount: room.events.length,
          deadline: registration.correspondenceDeadline(room),
        };
      },
      print: (report) => console.log(JSON.stringify(report)),
    });
  } finally {
    client.release();
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // Connection errors can embed connection parameters: print the error class
    // and a message with any connection URL removed. The read-only report and
    // transaction are safe to retry.
    console.error('Correspondence deadline maintenance failed; no repair report committed');
    console.error(redactedError(error));
    process.exitCode = 1;
  });
}
