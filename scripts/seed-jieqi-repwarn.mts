#!/usr/bin/env node
// Dev-only local Postgres fixture for the Jieqi repetition-loss dialog.
//   node --import tsx scripts/seed-jieqi-repwarn.mts --web http://127.0.0.1:3180
// Sign in on /account as repwarn-red@example.com (dev auth fills the code).
// Select the Red horse on e5, then play c4. Re-run for a fresh room.
// This script only connects to the fixed local QA DB; it never reads env files.
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiColor,
  type JieqiDeal,
  type JieqiMove,
} from '@mistboard/game';
import pg from 'pg';
import { jieqiTenant } from '../apps/server/src/jieqi-tenant.js';
import { createTenantRuntimeRoomFromEvents } from '../apps/server/src/variant-tenant/runtime.js';
import type { TenantRoomEvent } from '../apps/server/src/variant-tenant/tenant.js';

// Found through legal kernel play, then pinned. Deal stays in server storage;
// browser snapshots and replay are the normal recipient-masked live payloads.
const deal: JieqiDeal = {
  red: [
    'horse',
    'soldier',
    'elephant',
    'soldier',
    'chariot',
    'soldier',
    'advisor',
    'horse',
    'cannon',
    'advisor',
    'elephant',
    'cannon',
    'soldier',
    'soldier',
    'chariot',
  ],
  black: [
    'soldier',
    'horse',
    'advisor',
    'advisor',
    'horse',
    'soldier',
    'soldier',
    'chariot',
    'chariot',
    'elephant',
    'elephant',
    'cannon',
    'soldier',
    'cannon',
    'soldier',
  ],
};
const opening =
  'b3-b10 a10-b10 h3-h10 i10-h10 i1-i2 g10-e8 h1-g3 d10-e9 g3-h4 a7-a6 b1-c3 b8-b7 g1-i3 e10-d10 a1-b1 h10-h9 a4-a5 a6-a5 g4-g5 a5-a4 i2-g1 c10-a8 f1-e2 h8-h7 c4-c5 g7-g6 g5-g6 b10-b9 h4-g5 h7-h6 g6-h6 c7-c6 c5-f5 c6-a7 g5-f6 b9-b10 f6-e7 e8-e7 i4-i5 a4-a3 b1-a3 b10-b9 i5-i7 b9-a9 i7-e7 a9-a10 e7-e9 f10-e9 f5-f2 e9-e2 d1-e2 d10-d9 f2-f4 a10-f10 f4-f6 f10-f6 h6-h7 f6-f5 g1-i2 f5-f6 h7-g7 f6-b6 i3-i4 d9-d10 e1-f1 h9-h8 f1-f2 d10-e10 i2-g1 a8-c10 g7-h7 h8-h7 f2-f1 h7-h6 e2-e3 h6-h5 g1-h3 c10-e8 h3-i5 h5-i5 i4-i5 e8-c6 a3-c4 c6-e4 e3-e4';
const cycle = 'b6-c6 c4-e5 c6-b6 e5-c4';
const moves = (line: string): JieqiMove[] =>
  line.split(' ').map((token) => {
    const [from, to] = token.split('-');
    return { from, to } as JieqiMove;
  });
const { values } = parseArgs({
  options: { web: { type: 'string', default: 'http://localhost:3180' } },
});
const web = new URL(values.web!);
if (web.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(web.hostname))
  throw new Error('--web must be a local HTTP dev pair');
if (
  process.env.NODE_ENV === 'production' ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_SERVICE_NAME
)
  throw new Error('This fixture is local development only');

const line = [...moves(opening), ...moves(cycle), ...moves(cycle).slice(0, 3)];
let state = createInitialJieqiState('verify', deal, {
  repetition: true,
  adjudicationRule: 'jqe-v1',
});
for (const move of line) {
  const next = applyJieqiMove(state, move);
  if (next === state || next.status.type !== 'playing')
    throw new Error('Fixture is no longer legal');
  state = next;
}
const last = moves(cycle)[3]!;
const end = applyJieqiMove(state, last);
if (
  end.status.type !== 'finished' ||
  end.status.reason !== 'perpetual-chase' ||
  end.status.winner !== 'black'
)
  throw new Error('Fixture no longer ends with a Red chase loss');

const db = new pg.Client({
  connectionString: 'postgres://mistboard:mistboard@localhost:5435/mistboard',
});
await db.connect();
try {
  await db.query('BEGIN');
  const users = {} as Record<JieqiColor, string>;
  for (const seat of ['red', 'black'] as const) {
    const { rows } = await db.query(
      `INSERT INTO users (id, email, email_verified_at, handle, display_name, stats_excluded_at)
       VALUES ($1, $2, now(), $3, $4, now()) ON CONFLICT (lower(email)) DO UPDATE SET email_verified_at = now()
       RETURNING id`,
      [
        `repwarn-${seat}`,
        `repwarn-${seat}@example.com`,
        `repwarn-${seat}`,
        `Repetition review ${seat}`,
      ],
    );
    users[seat] = rows[0].id;
  }
  {
    const roomId = `jq_repwarn_${randomUUID()}`;
    const now = Date.now();
    const events: TenantRoomEvent<JieqiColor, JieqiMove, 'jieqi'>[] = [
      {
        type: 'room-created',
        roomId,
        at: now,
        gameSpecId: 'jieqi',
        setup: { ...deal, repetition: true, adjudicationRule: 'jqe-v1' },
        timeControl: { initialMs: 86_400_000, incrementMs: 0 },
      },
      ...(['red', 'black'] as const).map((seat) => ({
        type: 'seat-assigned' as const,
        roomId,
        at: now,
        seat,
        clientId: `user:${users[seat]}`,
      })),
      ...line.map((move, index) => ({
        type: 'move-played' as const,
        roomId,
        at: now,
        color: (index % 2 === 0 ? 'red' : 'black') as JieqiColor,
        move,
      })),
      {
        type: 'clock-started',
        roomId,
        at: now,
        clock: {
          activeColor: 'red',
          initialMs: 86_400_000,
          incrementMs: 0,
          remainingMs: { red: 86_400_000, black: 86_400_000 },
          runningSince: now,
        },
      },
    ];
    const hydrated = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
    if (!hydrated.ok || hydrated.room.projection.state.status.type !== 'playing')
      throw new Error('Fixture failed room replay');
    for (const [seq, event] of events.entries())
      await db.query('INSERT INTO events (room_id, seq, type, payload) VALUES ($1, $2, $3, $4)', [
        roomId,
        seq,
        event.type,
        event,
      ]);
    for (const seat of ['red', 'black'] as const)
      await db.query(
        `INSERT INTO room_seat_tokens (room_id, seat, client_id, token_hash, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
        [
          roomId,
          seat,
          `user:${users[seat]}`,
          createHash('sha256').update(randomUUID()).digest('hex'),
          users[seat],
        ],
      );
    const url = `${web.origin}/room/${roomId}`;
    console.log(`Red (repwarn-red@example.com) ${url}`);
    console.log(`Black (repwarn-black@example.com) ${url}`);
  }
  await db.query('COMMIT');
  console.log('Select Red horse e5, then c4. Use separate signed-in browsers for the two seats.');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
