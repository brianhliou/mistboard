#!/usr/bin/env node
// The KataGo jungle seat against MistyJungle level 2 at 1+1, on the real
// engines, through the live seat path (playJungleEngineMoveIfReady): the same
// clock, allocator, shared KataGo process and engine-move guard a player's game
// runs on. Rooms come from the real room factory, so the KataGo room prewarms
// the shared process exactly as a new game does. Colours alternate.
//
// The live loop seats one engine per room, so the script hands the room to the
// side to move before each turn: the engine id of the mover sits in its seat and
// the other seat holds a placeholder. Moves, clocks and results are the tenant's.
//
// Usage (tsx loads the server's TypeScript):
//   MISTBOARD_JUNGLE_ENABLED=true MISTBOARD_JUNGLE_RUST_ENGINE=true \
//   MISTBOARD_JUNGLE_ENGINE_PATH=<jungle-engine binary> \
//   MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH=<KataGomo animalchess katago> \
//   MISTBOARD_KATAGO_JUNGLE_NET_PATH=<b10 net .bin.gz> \
//   npx tsx scripts/jungle-katago-1p1-match.mjs [--games N]
//
// Exit 0: no KataGo time loss. Exit 1: KataGo lost at least one game on time.
// Exit 2: a required env var is unset.

import process from 'node:process';

const REQUIRED = [
  'MISTBOARD_JUNGLE_ENGINE_PATH',
  'MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH',
  'MISTBOARD_KATAGO_JUNGLE_NET_PATH',
];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`missing env: ${missing.join(', ')}`);
  console.error('also set: MISTBOARD_JUNGLE_ENABLED=true MISTBOARD_JUNGLE_RUST_ENGINE=true');
  process.exit(2);
}
process.env.MISTBOARD_JUNGLE_ENABLED = 'true';
process.env.MISTBOARD_JUNGLE_RUST_ENGINE = 'true';
delete process.env.MISTBOARD_BOT_PACING;
// Keep the server's structured logs off the report unless asked for.
process.env.LOG_LEVEL ??= 'error';

const gamesArg = process.argv.indexOf('--games');
const GAMES = gamesArg > 0 ? Number(process.argv[gamesArg + 1]) : 20;
if (!Number.isInteger(GAMES) || GAMES < 1) {
  console.error('--games takes a positive integer');
  process.exit(2);
}

const { TIME_CONTROLS } = await import('@mistboard/game');
const { closeKatagoJungleSession, KATAGO_JUNGLE_ENGINE_ID, katagoJungleSession } = await import(
  '../apps/server/src/jungle-katago-engine.ts'
);
const { createJungleLiveRoom } = await import('../apps/server/src/server-jungle-room-factory.ts');
const { JUNGLE_PLAYABLE_ENGINE_ID, playJungleEngineMoveIfReady } = await import(
  '../apps/server/src/server-jungle-engine.ts'
);
const { jungleTenant } = await import('../apps/server/src/jungle-tenant.ts');
const { appendTenantRuntimeEvent, expireTenantClock, tenantClockRemainingMs } = await import(
  '../apps/server/src/variant-tenant/runtime.ts'
);

const MISTY = JUNGLE_PLAYABLE_ENGINE_ID; // misty-jungle-level-2
const TC = TIME_CONTROLS.find((tc) => tc.id === '1m1');
const PLACEHOLDER = 'match-opponent';
const MAX_PLIES = 600;

const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function ctxFor() {
  return {
    now: () => Date.now(),
    appendEvent: async (room, event) => appendTenantRuntimeEvent(jungleTenant, room, event),
    broadcastEventAppended: () => {},
  };
}

async function playGame(index) {
  const katagoColor = index % 2 === 0 ? 'red' : 'black';
  const mistyColor = katagoColor === 'red' ? 'black' : 'red';
  const spawnsBefore = katagoJungleSession().stats().spawns;
  const rooms = new Map();
  const created = await createJungleLiveRoom(
    {
      jungleRooms: rooms,
      isRoomIdTaken: (id) => rooms.has(id),
      appendRoomEvent: async () => {},
      isPersistenceEnabled: () => false,
      recordPersistenceError: () => {},
    },
    { initialMs: TC.initialMs, incrementMs: TC.incrementMs },
    mistyColor,
    { engineId: KATAGO_JUNGLE_ENGINE_ID, seat: katagoColor },
  );
  if (!created.ok) throw new Error(`room not created: ${created.error}`);
  const room = created.room;
  const ctx = ctxFor();
  const engineFor = { [katagoColor]: KATAGO_JUNGLE_ENGINE_ID, [mistyColor]: MISTY };
  const wall = { [katagoColor]: [], [mistyColor]: [] };
  let timeLoss = null;
  let plies = 0;
  while (room.projection.state.status.type === 'playing' && plies < MAX_PLIES) {
    const mover = room.projection.state.status.turn;
    const other = mover === 'red' ? 'black' : 'red';
    room.projection = {
      ...room.projection,
      seats: { [mover]: engineFor[mover], [other]: PLACEHOLDER },
    };
    const eventsBefore = room.events.length;
    const started = Date.now();
    await playJungleEngineMoveIfReady(ctx, room);
    wall[mover].push(Date.now() - started);
    const appended = room.events.slice(eventsBefore);
    if (appended.some((event) => event.type === 'move-played')) {
      plies += 1;
      continue;
    }
    if (appended.length > 0) continue; // resigned or another terminal event
    // No move and no event: the turn guard refused a move past the flag. The
    // live clock timer appends this; here it is appended directly.
    const clock = room.projection.clock;
    const now = Date.now();
    if (clock && tenantClockRemainingMs(clock, mover, now) <= 0) {
      timeLoss = mover;
      appendTenantRuntimeEvent(jungleTenant, room, {
        type: 'clock-expired',
        at: now,
        roomId: room.id,
        color: mover,
        clock: expireTenantClock(clock, now, mover) ?? clock,
      });
      continue;
    }
    throw new Error(`no move from ${engineFor[mover]} at ply ${plies}`);
  }
  const status = room.projection.state.status;
  const who = (color) => (color === katagoColor ? 'katago' : 'misty');
  const result =
    status.type === 'finished'
      ? status.winner
        ? `${who(status.winner)} wins (${status.reason ?? 'finished'})`
        : `draw (${status.reason ?? 'finished'})`
      : `unfinished after ${plies} plies`;
  const k = wall[katagoColor];
  const line = {
    game: index + 1,
    katago: katagoColor,
    result,
    plies,
    katagoMoves: k.length,
    katagoTimeLoss: timeLoss === katagoColor,
    mistyTimeLoss: timeLoss === mistyColor,
    katagoMedianMs: median(k),
    katagoMaxMs: k.length ? Math.max(...k) : 0,
    mistyMedianMs: median(wall[mistyColor]),
    spawns: katagoJungleSession().stats().spawns - spawnsBefore,
    katagoClockLeftMs: room.projection.clock?.remainingMs?.[katagoColor] ?? null,
  };
  console.log(
    `game ${line.game} katago=${line.katago} ${line.result} plies=${line.plies}` +
      ` katago_moves=${line.katagoMoves} time_loss=${line.katagoTimeLoss ? 'katago' : line.mistyTimeLoss ? 'misty' : 'none'}` +
      ` katago_ms median=${line.katagoMedianMs} max=${line.katagoMaxMs}` +
      ` misty_ms median=${line.mistyMedianMs} spawns=${line.spawns}` +
      ` katago_clock_left_ms=${line.katagoClockLeftMs}`,
  );
  return line;
}

const lines = [];
try {
  for (let i = 0; i < GAMES; i += 1) lines.push(await playGame(i));
} finally {
  closeKatagoJungleSession();
}
const wins = lines.filter((l) => l.result.startsWith('katago wins')).length;
const losses = lines.filter((l) => l.result.startsWith('misty wins')).length;
const draws = lines.length - wins - losses;
const katagoTimeLosses = lines.filter((l) => l.katagoTimeLoss).length;
const allMax = Math.max(0, ...lines.map((l) => l.katagoMaxMs));
const allMedian = median(lines.map((l) => l.katagoMedianMs));
const spawns = lines.reduce((sum, l) => sum + l.spawns, 0);
console.log(
  `summary games=${lines.length} katago W-L-D ${wins}-${losses}-${draws}` +
    ` katago_time_losses=${katagoTimeLosses} katago_ms median_of_medians=${allMedian} max=${allMax}` +
    ` spawns=${spawns}`,
);
process.exit(katagoTimeLosses > 0 ? 1 : 0);
