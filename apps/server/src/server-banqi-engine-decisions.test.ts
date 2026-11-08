/**
 * Banqi PvE: the SUCCESS path records what the engine did.
 *
 * The failure path has always produced a full decision record; a move that
 * worked produced nothing at all, so "is this bot using the budget we give it?"
 * had no retrospective answer for banqi — only live logs, which die with the
 * container. That is the exact shape of the fog-xiangqi bug that ran for weeks
 * at ~1.8% of its allotted budget before telemetry made it visible.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { type BanqiGameState, createInitialBanqiState, getBanqiLegalMoves } from '@mistboard/game';
import { banqiMoveToEngineUci } from './banqi-fen.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from './persistence-game-lifecycle.js';
import { type BanqiEngineMoveProvider, playBanqiEngineMoveIfReady } from './server-banqi-engine.js';
import type { UciEval } from './uci-engine-harness.js';

const ROOM_ID = 'banqi_decisions';
const ENGINE_ID = 'misty-banqi';

type Appended = { type: string };

function fixture(state: BanqiGameState = createInitialBanqiState(ROOM_ID)) {
  const appended: Appended[] = [];
  const room = {
    id: ROOM_ID,
    events: [],
    projection: {
      state,
      seats: { red: ENGINE_ID, black: 'human-client' },
      clock: null,
    },
  };
  const ctx = {
    appendEvent: async (_room: unknown, event: Appended) => {
      // The queue must already be populated by the time the append runs: a
      // mating move finishes the game and flushes inside this same call.
      assert.ok(
        (room as { pendingDebugArtifacts?: unknown[] }).pendingDebugArtifacts?.length,
        'the decision must be queued BEFORE the event is appended',
      );
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  };
  return { room, ctx, appended };
}

/** A provider that plays the kernel's first legal move and reports a real search. */
function providerPlaying(state: BanqiGameState, search: Partial<UciEval> = {}) {
  const move = getBanqiLegalMoves(state)[0]!;
  const calls: Array<{ engineId: string; opts: unknown }> = [];
  const provider: BanqiEngineMoveProvider = async (engineId, _fen, opts) => {
    calls.push({ engineId, opts });
    return {
      best: banqiMoveToEngineUci(move),
      cp: 12,
      mate: null,
      depth: 17,
      nodes: 26_400,
      timeMs: 7_980,
      pv: [banqiMoveToEngineUci(move)],
      ...search,
    };
  };
  return { provider, move, calls };
}

test('banqi: an accepted engine move queues a decision with the budget and the search', async () => {
  const state = createInitialBanqiState(ROOM_ID);
  const { room, ctx, appended } = fixture(state);
  const { provider, move } = providerPlaying(state);

  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);

  assert.deepEqual(
    appended.map((e) => e.type),
    ['move-played'],
    'the move still reaches the event log',
  );
  const queued = (room as { pendingDebugArtifacts?: Array<Record<string, unknown>> })
    .pendingDebugArtifacts;
  assert.equal(queued?.length, 1, 'the success path must record a decision');
  const entry = queued![0]!;
  assert.equal(entry.gameId, ROOM_ID);
  assert.equal(entry.artifactType, LIVE_ENGINE_DECISION_ARTIFACT_TYPE);
  assert.equal(entry.engineColor, null);

  const payload = entry.payload as Record<string, unknown>;
  assert.equal(payload.variant, 'banqi');
  assert.equal(payload.engine_id, ENGINE_ID);
  assert.equal(payload.engine_seat, 'red');
  assert.equal(payload.move, banqiMoveToEngineUci(move));
  assert.equal(payload.failed_closed, false);
  // The whole point: the budget the server allotted, the node budget the tier is
  // configured with, and what the search actually spent, in one row.
  assert.equal(payload.movetime_ms, 8_000, 'untimed game gets the tier ceiling');
  // Pinned deliberately, not read from the tier: the point of this row is that the artifact
  // records the budget the tier was CONFIGURED with, so reading the tier here would make the
  // assertion tautological. The historical bot remains classical L7 at 3.5M nodes.
  assert.equal(payload.tier_nodes, 3_500_000);
  assert.deepEqual(payload.search, {
    depth: 17,
    nodes: 26_400,
    time_ms: 7_980,
    cp: 12,
    mate: null,
    pv: [banqiMoveToEngineUci(move)],
  });
  assert.equal(typeof payload.think_time_ms, 'number');
  assert.ok((payload.legal_count as number) > 0);
  assert.equal(typeof payload.fen, 'string', 'the redacted FEN the engine was handed');
});

test('banqi: an engine that reports no search still records the budget it was given', async () => {
  // An older binary emits no `info` lines. The decision must still land, with a
  // null search — "we do not know what it spent" is a different and much more
  // recoverable answer than no row at all.
  const state = createInitialBanqiState(ROOM_ID);
  const { room, ctx } = fixture(state);
  const move = getBanqiLegalMoves(state)[0]!;
  const provider: BanqiEngineMoveProvider = async () => ({
    best: banqiMoveToEngineUci(move),
    cp: null,
    mate: null,
    depth: 0,
  });

  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);

  const payload = (room as { pendingDebugArtifacts?: Array<{ payload: Record<string, unknown> }> })
    .pendingDebugArtifacts?.[0]?.payload;
  assert.ok(payload);
  assert.equal(payload.movetime_ms, 8_000);
  assert.deepEqual(payload.search, {
    depth: 0,
    nodes: null,
    time_ms: null,
    cp: null,
    mate: null,
    pv: [],
  });
});

test('banqi: a timed seat records the clock it decided against', async () => {
  const state = createInitialBanqiState(ROOM_ID);
  const { room, ctx } = fixture(state);
  // 60s banked with a 5s increment: budgetForMove hands out bank/30 + 0.8·inc,
  // well under the tier's 8s ceiling. The artifact has to show that number, not
  // the ceiling, or "why did the bot move so fast" is unanswerable.
  (room.projection as { clock: unknown }).clock = {
    incrementMs: 5_000,
    remainingMs: { red: 60_000, black: 60_000 },
    activeColor: 'red',
    runningSince: null,
  };
  const { provider } = providerPlaying(state);

  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);

  const payload = (room as { pendingDebugArtifacts?: Array<{ payload: Record<string, unknown> }> })
    .pendingDebugArtifacts?.[0]?.payload;
  assert.ok(payload);
  assert.equal(payload.increment_ms, 5_000);
  assert.equal(typeof payload.remaining_ms, 'number');
  assert.ok(
    (payload.movetime_ms as number) < 8_000,
    'a clock-aware budget must be recorded as allotted, not as the tier ceiling',
  );
});
