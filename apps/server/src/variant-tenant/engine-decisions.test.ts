/**
 * The shared per-move engine-decision queue and payload.
 *
 * Every tenant PvE loop writes through these two functions, so a regression here
 * silently blinds every variant at once — which is the failure this module was
 * added to end, not to reintroduce one level up.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEngineDecisionRecord } from '../engine-move-guard.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from '../persistence-game-lifecycle.js';
import {
  buildLiveEngineDecisionPayload,
  type EngineDecisionQueueRoom,
  MAX_QUEUED_ENGINE_DECISIONS,
  queueEngineDecision,
  queueFailClosedEngineDecision,
} from './engine-decisions.js';

function room(id = 'room_queue'): EngineDecisionQueueRoom {
  return { id };
}

test('a queued decision carries the room id, the ply, the type and the payload', () => {
  const r = room('banqi_1');
  queueEngineDecision(r, { ply: 7, move: 'a0b0' });

  assert.deepEqual(r.pendingDebugArtifacts, [
    {
      gameId: 'banqi_1',
      ply: 7,
      // The artifacts table's engine_color column is chess-typed, so a red/black
      // seat has to travel inside the payload and the column stays null.
      engineColor: null,
      artifactType: LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
      payload: { ply: 7, move: 'a0b0' },
    },
  ]);
});

test('a payload with no numeric ply degrades to a null ply rather than throwing', () => {
  const r = room();
  queueEngineDecision(r, { move: 'a0b0' });
  assert.equal(r.pendingDebugArtifacts?.[0]?.ply, null);

  const notANumber = room();
  queueEngineDecision(notANumber, { ply: '12', move: 'a0b0' });
  assert.equal(notANumber.pendingDebugArtifacts?.[0]?.ply, null);
});

test('the queue is capped, and the entries it keeps are the OLDEST', () => {
  const r = room();
  for (let ply = 0; ply < MAX_QUEUED_ENGINE_DECISIONS + 50; ply += 1) {
    queueEngineDecision(r, { ply });
  }
  assert.equal(r.pendingDebugArtifacts?.length, MAX_QUEUED_ENGINE_DECISIONS);
  assert.equal(r.pendingDebugArtifacts?.[0]?.ply, 0, 'the opening plies survive');
  assert.equal(
    r.pendingDebugArtifacts?.[MAX_QUEUED_ENGINE_DECISIONS - 1]?.ply,
    MAX_QUEUED_ENGINE_DECISIONS - 1,
  );
});

// ── The payload ─────────────────────────────────────────────────────────────
// What an investigation reads first: the budget the server gave, the limits the
// rung is configured with, and what the search actually spent. Those three
// disagreeing is the whole point of the artifact.

test('the payload carries the budget, the tier limits and the search side by side', () => {
  const payload = buildLiveEngineDecisionPayload({
    variant: 'banqi',
    roomId: 'banqi_1',
    engineId: 'misty-banqi',
    engineVersion: '0.2.5',
    seat: 'red',
    ply: 12,
    budgetMs: 8_000,
    remainingMs: 240_000,
    incrementMs: 5_000,
    tier: { nodes: 1_500_000, movetimeMs: 8_000 },
    search: {
      best: 'a0b0',
      cp: 35,
      mate: null,
      depth: 18,
      nodes: 26_400,
      timeMs: 7_980,
      pv: ['a0b0', 'b1b0', 'c0c1', 'd3d2', 'a1a2', 'b2b3', 'c2c3', 'd0d1', 'a2a3'],
    },
    thinkTimeMs: 8_120,
    attempts: [{ attempt: 1, uci: 'a0b0', error: null, reason: null }],
    move: 'a0b0',
    fen: 'redacted-fen',
    legalCount: 31,
  });

  assert.equal(payload.variant, 'banqi');
  assert.equal(payload.room_id, 'banqi_1');
  assert.equal(payload.engine_seat, 'red');
  assert.equal(payload.ply, 12);
  assert.equal(payload.move, 'a0b0');
  assert.equal(payload.failed_closed, false);
  assert.equal(payload.guard_replaced, false);
  assert.equal(payload.legal_count, 31);
  assert.equal(payload.fen, 'redacted-fen');
  // The under-utilisation question, in three numbers: 26.4k nodes searched
  // against a 1.5M budget, with time pinned at the 8s cap.
  assert.equal(payload.movetime_ms, 8_000);
  assert.equal(payload.tier_nodes, 1_500_000);
  assert.deepEqual(payload.search, {
    depth: 18,
    nodes: 26_400,
    time_ms: 7_980,
    cp: 35,
    mate: null,
    // Capped so the artifact stays small; eight plies read the plan.
    pv: ['a0b0', 'b1b0', 'c0c1', 'd3d2', 'a1a2', 'b2b3', 'c2c3', 'd0d1'],
  });
  // The whole-game move list and legal-move list are deliberately NOT written
  // per ply: both are derivable from the event log, and writing them on every
  // move puts the game into every one of its own rows.
  assert.equal('history' in payload, false);
  assert.equal('legal_moves' in payload, false);
});

test('the payload distinguishes an unbudgeted engine from a zero budget', () => {
  const payload = buildLiveEngineDecisionPayload({
    variant: 'jungle',
    roomId: 'jungle_1',
    engineId: 'misty-jungle-level-2',
    engineVersion: '0.1.0',
    seat: 'red',
    ply: 3,
    // The in-process TS search is depth-limited with no server time budget at
    // all. Reporting 0 here would read as "allotted nothing", a different bug.
    budgetMs: null,
    remainingMs: null,
    incrementMs: 0,
    tier: { depth: 4 },
    search: null,
    thinkTimeMs: 41,
    attempts: [],
    move: 'd8d9',
  });
  assert.equal(payload.movetime_ms, null);
  assert.equal(
    payload.tier_depth,
    4,
    'depth survives; the record type predates depth-capped rungs',
  );
  assert.equal(payload.tier_nodes, null);
  assert.equal(payload.search, null, 'an engine that reports no search says so');
  assert.equal(payload.engine_move, null);
  assert.equal(payload.attempts, 0);
  assert.equal(payload.unreachable, false, 'no attempts is not "the engine never answered"');
});

test('the payload marks a guard replacement and keeps what the engine wanted', () => {
  const payload = buildLiveEngineDecisionPayload({
    variant: 'fortress-xiangqi',
    roomId: 'fx_1',
    engineId: 'fairy-stockfish-fortress-xiangqi-level-8',
    engineVersion: '0.3.0',
    seat: 'black',
    ply: 41,
    budgetMs: 6_000,
    remainingMs: 30_000,
    incrementMs: 0,
    tier: { skill: 20, nodes: 800_000, movetimeMs: 6_000 },
    search: { best: 'b1b3', cp: -220, mate: null, depth: 14 },
    thinkTimeMs: 2_400,
    attempts: [{ attempt: 1, uci: 'b1b3', error: null, reason: null }],
    move: 'c1c3',
    guardReplaced: true,
  });
  assert.equal(payload.engine_move, 'b1b3', 'what the engine wanted');
  assert.equal(payload.move, 'c1c3', 'what was played');
  assert.equal(payload.guard_replaced, true);
  assert.equal(payload.tier_skill, 20);
  assert.deepEqual(payload.search, {
    depth: 14,
    nodes: null,
    time_ms: null,
    cp: -220,
    mate: null,
    pv: [],
  });
});

test('a fail-closed decision is the thin readout mark: identities and counts, no position', () => {
  const room: EngineDecisionQueueRoom = { id: 'room-fc' };
  const record = buildEngineDecisionRecord({
    variant: 'banqi',
    roomId: 'room-fc',
    engineId: 'banqi-search',
    engineVersion: 'v1',
    movetimeMs: 1_000,
    ply: 12,
    toMove: 'black',
    inCheck: false,
    fen: 'SECRET-DEAL-FEN',
    history: ['a1a2'],
    legalUci: ['b1b2'],
    attempts: [],
  });
  queueFailClosedEngineDecision(room, record);
  const [entry] = room.pendingDebugArtifacts ?? [];
  assert.equal(entry?.artifactType, LIVE_ENGINE_DECISION_ARTIFACT_TYPE);
  assert.equal(entry?.ply, 12);
  const payload = entry?.payload as Record<string, unknown>;
  assert.equal(payload.failed_closed, true);
  assert.equal(payload.move, null);
  assert.equal(payload.variant, 'banqi');
  assert.equal(payload.engine_seat, 'black');
  for (const key of ['fen', 'history', 'legal_moves', 'last_output', 'attempts_detail']) {
    assert.equal(key in payload, false, key);
  }
  assert.doesNotMatch(JSON.stringify(payload), /SECRET-DEAL-FEN|a1a2|b1b2/);
});
