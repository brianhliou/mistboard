/**
 * The KataGo jungle seat against a real clock (jgl_29484585, 2026-11-12: it lost
 * a won 1+1 game on time). Each test replays a timed game through the live loop:
 * the opponent moves instantly, and every bot move is charged the wall time the
 * engine it went to measurably needs on prod, not what the stub took here.
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
  katagoStageSeconds,
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
// are in jungle-katago-engine.ts and jungle-katago-time.ts). Kept here rather
// than imported so the replay judges the seat, not the seat's own model of itself.
const KATAGO_PROD_STARTUP_MS = 1_650;
// 150 visits fill a stage in ~1.2 s on this Mac; prod runs ~1.45x slower.
const KATAGO_PROD_VISITS_STAGE_MS = 1_750;
const MISTY_PROD_OVERHEAD_MS = 30;

function katagoProdWallMs(movetimeCapMs: number): number {
  const stageMs = Math.round(katagoStageSeconds(movetimeCapMs) * 1000);
  return KATAGO_PROD_STARTUP_MS + 2 * Math.min(stageMs, KATAGO_PROD_VISITS_STAGE_MS);
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
  engine: 'katago' | 'misty';
  movetimeCapMs: number;
  visits: number | null;
  wallMs: number;
  payload: Record<string, unknown>;
};

/** Play `botMoves` bot moves at `tc`; stops early only if the bot's clock runs out. */
async function replay(
  tc: { initialMs: number; incrementMs: number },
  botMoves: number,
): Promise<{ moves: BotMove[]; flaggedAt: number | null }> {
  const now = 1_000_000;
  let state: JungleGameState = createInitialJungleState(ROOM_ID);
  let remaining = tc.initialMs;
  const moves: BotMove[] = [];
  const pick = (s: JungleGameState, salt: number) => {
    const legal = getJungleLegalMoves(s);
    return legal[(salt * 7 + 3) % legal.length]!;
  };
  for (let i = 0; i < botMoves; i += 1) {
    const before = state;
    const reply = jungleMoveToEngineUci(pick(before, i));
    let charged: Omit<BotMove, 'remainingBeforeMs' | 'payload'> | null = null;
    const katago: KatagoJungleMoveProvider = async (_fen, _mover, opts) => {
      charged = {
        engine: 'katago',
        movetimeCapMs: opts.movetimeCapMs,
        visits: opts.visits,
        wallMs: katagoProdWallMs(opts.movetimeCapMs),
      };
      return { best: reply, cp: null, mate: null, depth: 0, timeMs: 0 };
    };
    const misty: JungleEngineMoveProvider = async (_engineId, _fen, opts) => {
      const cap = opts.movetimeCapMs ?? 0;
      charged = {
        engine: 'misty',
        movetimeCapMs: cap,
        visits: null,
        wallMs: cap + MISTY_PROD_OVERHEAD_MS,
      };
      return { best: reply, cp: null, mate: null, depth: 0, timeMs: 0 };
    };
    const room = {
      id: ROOM_ID,
      events: [],
      projection: {
        state: before,
        seats: { red: KATAGO_JUNGLE_ENGINE_ID, black: 'human-client' },
        clock: {
          activeColor: 'red',
          incrementMs: tc.incrementMs,
          initialMs: tc.initialMs,
          remainingMs: { red: remaining, black: tc.initialMs },
          runningSince: now,
        },
      },
    };
    const appended: Array<{ type: string; move?: unknown }> = [];
    const ctx = {
      now: () => now,
      appendEvent: async (_room: unknown, event: { type: string }) => {
        appended.push(event);
        return appended.length;
      },
      broadcastEventAppended: () => {},
    };
    await playJungleEngineMoveIfReady(ctx as never, room as never, misty, katago);
    assert.equal(appended[0]?.type, 'move-played', `bot move ${i + 1} was played`);
    assert.ok(charged, `bot move ${i + 1} asked an engine`);
    const spent = charged as Omit<BotMove, 'remainingBeforeMs' | 'payload'>;
    const payload =
      (room as { pendingDebugArtifacts?: Array<{ payload: Record<string, unknown> }> })
        .pendingDebugArtifacts?.[0]?.payload ?? {};
    moves.push({ ...spent, remainingBeforeMs: remaining, payload });
    remaining -= spent.wallMs;
    if (remaining <= 0) return { moves, flaggedAt: i + 1 };
    remaining += tc.incrementMs;

    state = applyJungleMove(before, pick(before, i));
    if (state.status.type === 'playing') state = applyJungleMove(state, pick(state, i + 11));
    // A long game, not a won one: when the walk ends a game, the clock plays on.
    if (state.status.type !== 'playing') state = createInitialJungleState(ROOM_ID);
  }
  return { moves, flaggedAt: null };
}

const tcById = (id: string) => TIME_CONTROLS.find((tc) => tc.id === id)!;

test('at 1+1 the seat never runs its clock out, with KataGo slower than the increment', async () => {
  const { moves, flaggedAt } = await withEnv(ENV, () => replay(tcById('1m1'), 80));
  assert.equal(flaggedAt, null, `flagged at bot move ${flaggedAt}`);
  assert.equal(moves.length, 80);
  for (const [index, move] of moves.entries()) {
    // No move spends more than the increment plus a fair share of the bank.
    const allowance = 1_000 + move.remainingBeforeMs / 30;
    assert.ok(
      move.wallMs <= allowance,
      `move ${index + 1}: ${move.wallMs} ms against ${Math.round(allowance)} ms allowed`,
    );
  }
  // KataGo opens while the bank pays for it; MistyJungle carries the rest.
  assert.equal(moves[0]!.engine, 'katago');
  assert.ok(moves.some((move) => move.engine === 'misty'));
});

test('the decision artifact says which engine made each move', async () => {
  const { moves } = await withEnv(ENV, () => replay(tcById('1m1'), 30));
  for (const move of moves) assert.equal(move.payload.mode, move.engine);
});

test('at 10+5 every move is the KataGo move it always was', async () => {
  const tc = tcById('10m5');
  const { moves, flaggedAt } = await withEnv(ENV, () => replay(tc, 60));
  assert.equal(flaggedAt, null);
  for (const move of moves) {
    // The allocator as it was called before the modes existed.
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
    assert.equal(move.engine, 'katago');
    assert.equal(move.payload.mode, 'katago');
    assert.equal(move.visits, 150);
    assert.equal(move.movetimeCapMs, before);
    assert.equal(move.movetimeCapMs, 6_000);
    assert.equal(move.payload.movetime_ms, 6_000);
  }
  // And the GTP script at that cap is byte for byte the one it always sent.
  assert.deepEqual(
    katagoMoveCommands(jungleStateToEngineFen(createInitialJungleState(ROOM_ID)), 'red', {
      visits: 150,
      movetimeCapMs: 6_000,
    }).slice(0, 2),
    ['kata-set-param maxVisits 150', 'kata-set-param maxTime 2.500'],
  );
});

test('3+2 and 5+5 hold their clocks too', async () => {
  for (const id of ['3m2', '5m5']) {
    const { flaggedAt } = await withEnv(ENV, () => replay(tcById(id), 80));
    assert.equal(flaggedAt, null, `${id} flagged at bot move ${flaggedAt}`);
  }
});

test('without the Rust engine the light move is the in-process search', async () => {
  const state = createInitialJungleState(ROOM_ID);
  const room = {
    id: ROOM_ID,
    events: [],
    projection: {
      state,
      seats: { red: KATAGO_JUNGLE_ENGINE_ID, black: 'human-client' },
      // 20 s at 1+1 buys ~1.5 s, under KataGo's floor.
      clock: {
        activeColor: 'red',
        incrementMs: 1_000,
        initialMs: 60_000,
        remainingMs: { red: 20_000, black: 60_000 },
        runningSince: 1_000_000,
      },
    },
  };
  const appended: Array<{ type: string; move?: unknown }> = [];
  const ctx = {
    now: () => 1_000_000,
    appendEvent: async (_room: unknown, event: { type: string }) => {
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  };
  const refuse = async (): Promise<never> => {
    throw new Error('no external engine on this path');
  };
  await withEnv({ ...ENV, MISTBOARD_JUNGLE_RUST_ENGINE: undefined }, () =>
    playJungleEngineMoveIfReady(ctx as never, room as never, refuse, refuse),
  );
  assert.equal(appended[0]?.type, 'move-played');
  const payload = (room as { pendingDebugArtifacts?: Array<{ payload: Record<string, unknown> }> })
    .pendingDebugArtifacts?.[0]?.payload;
  assert.equal(payload?.mode, 'misty-ts');
});
