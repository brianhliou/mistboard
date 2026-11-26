/**
 * The KataGo jungle seat against a real clock (jgl_29484585, 2026-11-12: it lost
 * a won 1+1 game on time). Each test replays a timed game through the live loop:
 * the opponent moves instantly, and every bot move is charged the wall time
 * KataGo measurably needs on prod on the shared process (cold on the first move,
 * warm after), not what the stub took here.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyJungleMove,
  createInitialJungleState,
  getJungleLegalMoves,
  type JungleGameState,
  TIME_CONTROLS,
} from '@mistboard/game';
import { liveBotMoveTime } from './engine-time-budget.js';
import { jungleMoveToEngineUci, jungleStateToEngineFen } from './jungle-fen.js';
import {
  KATAGO_JUNGLE_ENGINE_ID,
  katagoMoveCommands,
  katagoStageSecondsForMove,
} from './jungle-katago-engine.js';
import {
  type JungleEngineMoveProvider,
  type KatagoJungleMoveProvider,
  playJungleEngineMoveIfReady,
} from './server-jungle-engine.js';

const ROOM_ID = 'jgl_katago_clock';
const assets = mkdtempSync(join(tmpdir(), 'katago-jungle-clock-'));
for (const file of ['katago-jungle', 'katago-jungle-net.bin.gz', 'jungle-engine']) {
  writeFileSync(join(assets, file), '');
}

// Prod wall time per move, from measurements (2026-11-25; the figures behind them
// are in jungle-katago-engine.ts). Kept here rather than imported so the replay
// judges the seat, not the seat's own model of itself.
const KATAGO_PROD_STARTUP_MS = 1_650;
// The setup replies and two genmove round trips on the loaded process: 55 ms on
// this Mac, ~3.3x on prod.
const KATAGO_PROD_WARM_OVERHEAD_MS = 180;
// 150 visits fill a stage in ~1.2 s on this Mac; prod runs ~1.45x slower.
const KATAGO_PROD_VISITS_STAGE_MS = 1_750;

function katagoProdWallMs(movetimeCapMs: number, cold: boolean): number {
  const waitedMs = cold ? KATAGO_PROD_STARTUP_MS : 0;
  const stageMs = Math.round(katagoStageSecondsForMove(movetimeCapMs, waitedMs) * 1000);
  return (
    waitedMs + KATAGO_PROD_WARM_OVERHEAD_MS + 2 * Math.min(stageMs, KATAGO_PROD_VISITS_STAGE_MS)
  );
}

const ENV = {
  MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH: join(assets, 'katago-jungle'),
  MISTBOARD_KATAGO_JUNGLE_NET_PATH: join(assets, 'katago-jungle-net.bin.gz'),
  MISTBOARD_JUNGLE_RUST_ENGINE: 'true',
  MISTBOARD_JUNGLE_ENGINE_PATH: join(assets, 'jungle-engine'),
  MISTBOARD_BOT_PACING: undefined,
} as const;

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>) {
  const saved = Object.keys(overrides).map((key) => [key, process.env[key]] as const);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

type BotMove = {
  remainingBeforeMs: number;
  process: 'warm' | 'cold';
  movetimeCapMs: number;
  visits: number;
  wallMs: number;
  payload: Record<string, unknown>;
};

function liveRoom(
  state: JungleGameState,
  tc: { initialMs: number; incrementMs: number },
  remaining: number,
) {
  return {
    id: ROOM_ID,
    events: [],
    projection: {
      state,
      seats: { red: KATAGO_JUNGLE_ENGINE_ID, black: 'human-client' },
      clock: {
        activeColor: 'red',
        incrementMs: tc.incrementMs,
        initialMs: tc.initialMs,
        remainingMs: { red: remaining, black: tc.initialMs },
        runningSince: 1_000_000,
      },
    },
  };
}

function recordingCtx() {
  const appended: Array<{ type: string; move?: unknown }> = [];
  const ctx = {
    now: () => 1_000_000,
    appendEvent: async (_room: unknown, event: { type: string }) => {
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  };
  return { ctx, appended };
}

/** A MistyJungle provider that must never be asked: the seat has no fallback. */
function forbiddenMisty() {
  const calls = { count: 0 };
  const provider: JungleEngineMoveProvider = async () => {
    calls.count += 1;
    throw new Error('MistyJungle was asked to move for the KataGo seat');
  };
  return { calls, provider };
}

/**
 * Play `botMoves` bot moves at `tc`; stops early only if the bot's clock runs out.
 * The first move starts the process (no prewarm: the worst case); the rest reuse it.
 */
async function replay(
  tc: { initialMs: number; incrementMs: number },
  botMoves: number,
): Promise<{ moves: BotMove[]; flaggedAt: number | null; mistyCalls: number }> {
  let state: JungleGameState = createInitialJungleState(ROOM_ID);
  let remaining = tc.initialMs;
  let loaded = false;
  const moves: BotMove[] = [];
  const misty = forbiddenMisty();
  const pick = (s: JungleGameState, salt: number) => {
    const legal = getJungleLegalMoves(s);
    return legal[(salt * 7 + 3) % legal.length]!;
  };
  for (let i = 0; i < botMoves; i += 1) {
    const before = state;
    const reply = jungleMoveToEngineUci(pick(before, i));
    let charged: Omit<BotMove, 'remainingBeforeMs' | 'payload'> | null = null;
    const katago: KatagoJungleMoveProvider = async (_fen, _mover, opts) => {
      const cold = !loaded;
      loaded = true;
      charged = {
        process: cold ? 'cold' : 'warm',
        movetimeCapMs: opts.movetimeCapMs,
        visits: opts.visits,
        wallMs: katagoProdWallMs(opts.movetimeCapMs, cold),
      };
      return {
        best: reply,
        cp: null,
        mate: null,
        depth: 0,
        timeMs: 0,
        process: cold ? 'cold' : 'warm',
      };
    };
    const room = liveRoom(before, tc, remaining);
    const { ctx, appended } = recordingCtx();
    await playJungleEngineMoveIfReady(ctx as never, room as never, misty.provider, katago);
    assert.equal(appended[0]?.type, 'move-played', `bot move ${i + 1} was played`);
    assert.ok(charged, `bot move ${i + 1} asked KataGo`);
    const spent = charged as Omit<BotMove, 'remainingBeforeMs' | 'payload'>;
    const payload =
      (room as { pendingDebugArtifacts?: Array<{ payload: Record<string, unknown> }> })
        .pendingDebugArtifacts?.[0]?.payload ?? {};
    moves.push({ ...spent, remainingBeforeMs: remaining, payload });
    remaining -= spent.wallMs;
    if (remaining <= 0) return { moves, flaggedAt: i + 1, mistyCalls: misty.calls.count };
    remaining += tc.incrementMs;

    state = applyJungleMove(before, pick(before, i));
    if (state.status.type === 'playing') state = applyJungleMove(state, pick(state, i + 11));
    // A long game, not a won one: when the walk ends a game, the clock plays on.
    if (state.status.type !== 'playing') state = createInitialJungleState(ROOM_ID);
  }
  return { moves, flaggedAt: null, mistyCalls: misty.calls.count };
}

const tcById = (id: string) => TIME_CONTROLS.find((tc) => tc.id === id)!;

test('at 1+1 KataGo makes every move and never runs its clock out', async () => {
  const { moves, flaggedAt, mistyCalls } = await withEnv(ENV, () => replay(tcById('1m1'), 200));
  assert.equal(flaggedAt, null, `flagged at bot move ${flaggedAt}`);
  assert.equal(moves.length, 200);
  assert.equal(mistyCalls, 0, 'no other engine stands in');
  for (const [index, move] of moves.entries()) {
    // No move spends more than the increment plus a fair share of the bank.
    const allowance = 1_000 + move.remainingBeforeMs / 30;
    assert.ok(
      move.wallMs <= allowance,
      `move ${index + 1}: ${move.wallMs} ms against ${Math.round(allowance)} ms allowed`,
    );
  }
  // The clock settles rather than draining: the last 50 moves hold the bank.
  const tail = moves.slice(-50);
  assert.ok(
    tail.at(-1)!.remainingBeforeMs >= tail[0]!.remainingBeforeMs - 1_000,
    `bank ${tail[0]!.remainingBeforeMs} -> ${tail.at(-1)!.remainingBeforeMs}`,
  );
});

test('the decision artifact says whether the move reused the process', async () => {
  const { moves } = await withEnv(ENV, () => replay(tcById('1m1'), 30));
  assert.equal(moves[0]!.process, 'cold');
  for (const move of moves) assert.equal(move.payload.mode, move.process);
  assert.ok(moves.slice(1).every((move) => move.payload.mode === 'warm'));
});

test('at 10+5 every move is the KataGo move it always was', async () => {
  const tc = tcById('10m5');
  const { moves, flaggedAt } = await withEnv(ENV, () => replay(tc, 60));
  assert.equal(flaggedAt, null);
  for (const move of moves) {
    // The allocator as it is called on main.
    const before = liveBotMoveTime({
      variant: 'jungle',
      initialMs: tc.initialMs,
      correspondence: false,
      roomId: ROOM_ID,
      ply: 1,
      legalCount: 20,
      remainingMs: move.remainingBeforeMs,
      incrementMs: tc.incrementMs,
      engineVsEngine: false,
      engineId: KATAGO_JUNGLE_ENGINE_ID,
      ceilingMs: 6_000,
      flatReserveMs: 1_000,
      floorMs: 50,
      pacingEnabled: false,
    }).movetimeMs;
    assert.equal(move.visits, 150);
    assert.equal(move.movetimeCapMs, before);
    assert.equal(move.movetimeCapMs, 6_000);
    assert.equal(move.payload.movetime_ms, 6_000);
  }
  // And the budget lines at that cap are the ones it always sent.
  const commands = katagoMoveCommands(
    jungleStateToEngineFen(createInitialJungleState(ROOM_ID)),
    'red',
    { visits: 150, movetimeCapMs: 6_000 },
  );
  assert.ok(commands.includes('kata-set-param maxVisits 150'));
  assert.ok(commands.includes('kata-set-param maxTime 2.500'));
});

test('3+2 and 5+5 hold their clocks too', async () => {
  for (const id of ['3m2', '5m5']) {
    const { flaggedAt } = await withEnv(ENV, () => replay(tcById(id), 80));
    assert.equal(flaggedAt, null, `${id} flagged at bot move ${flaggedAt}`);
  }
});

test('a KataGo that cannot answer in time resigns the seat, never a MistyJungle move', async () => {
  const tc = tcById('1m1');
  const room = liveRoom(createInitialJungleState(ROOM_ID), tc, 20_000);
  const { ctx, appended } = recordingCtx();
  const misty = forbiddenMisty();
  let asked = 0;
  // What the shared session does when a move outruns its deadline: it kills the
  // process and the request rejects.
  const slow: KatagoJungleMoveProvider = async () => {
    asked += 1;
    throw new Error('KataGo jungle move timed out');
  };
  await withEnv(ENV, () =>
    playJungleEngineMoveIfReady(ctx as never, room as never, misty.provider, slow),
  );
  assert.equal(asked, 2, 'one retry, as for every jungle engine');
  assert.equal(misty.calls.count, 0);
  assert.deepEqual(
    appended.map((event) => event.type),
    ['seat-resigned'],
  );
});
