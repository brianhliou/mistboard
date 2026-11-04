import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { XiangqiMove } from '@mistboard/game';
import { buildXiangqiEngineDecisionPayload, legalMoveForUci } from './server-xiangqi-engine.js';
import { queueEngineDecision } from './variant-tenant/engine-decisions.js';
import {
  xiangqiEngineVersion as catalogXiangqiEngineVersion,
  isXiangqiEngineClientId as isCatalogXiangqiEngineClientId,
  XIANGQI_PLAYABLE_ENGINES as XIANGQI_ENGINE_CATALOG,
  XIANGQI_DEFAULT_ENGINE_ID as XIANGQI_PUBLIC_DEFAULT_ENGINE_ID,
  XIANGQI_PUBLIC_ENGINES,
} from './xiangqi-engine-catalog.js';
import {
  isXiangqiEngineClientId,
  XIANGQI_DEFAULT_ENGINE_ID,
  XIANGQI_LEGACY_ENGINE_TIERS,
  XIANGQI_PLAYABLE_ENGINES,
  xiangqiEngineDisplayName,
  xiangqiEngineTierFor,
  xiangqiEngineVersion,
  xiangqiMoveToPikafishUci,
  xiangqiSquareToPikafish,
} from './xiangqi-pikafish-engine.js';

// Our XiangqiSquare is `${file a-i}${rank 1-10}` (red back rank = rank 1);
// Pikafish UCI uses rank 0-9 (red back rank = rank 0). The only translation is a
// rank-1 shift. Empirically validated end-to-end against the mainline binary in
// src/scripts/xiangqi-pikafish-validate.ts — these lock the contract as a unit.

test('xiangqiSquareToPikafish applies the rank-1 shift', () => {
  assert.equal(xiangqiSquareToPikafish('e1'), 'e0'); // red general
  assert.equal(xiangqiSquareToPikafish('a1'), 'a0');
  assert.equal(xiangqiSquareToPikafish('i10'), 'i9');
  assert.equal(xiangqiSquareToPikafish('e10'), 'e9'); // black general
  assert.equal(xiangqiSquareToPikafish('h3'), 'h2'); // red right cannon
});

test('xiangqiMoveToPikafishUci concatenates the shifted squares', () => {
  assert.equal(xiangqiMoveToPikafishUci({ from: 'h3', to: 'e3' }), 'h2e2'); // cannon to center
  assert.equal(xiangqiMoveToPikafishUci({ from: 'b1', to: 'c3' }), 'b0c2'); // horse
  assert.equal(xiangqiMoveToPikafishUci({ from: 'h10', to: 'g8' }), 'h9g7'); // black horse
});

test('legalMoveForUci matches a Pikafish bestmove against the legal set', () => {
  const legal: XiangqiMove[] = [
    { from: 'h3', to: 'e3' },
    { from: 'b1', to: 'c3' },
  ];
  assert.deepEqual(legalMoveForUci(legal, 'h2e2'), { from: 'h3', to: 'e3' });
  assert.deepEqual(legalMoveForUci(legal, 'b0c2'), { from: 'b1', to: 'c3' });
});

test('legalMoveForUci rejects moves outside the legal set and malformed uci', () => {
  const legal: XiangqiMove[] = [{ from: 'h3', to: 'e3' }];
  assert.equal(legalMoveForUci(legal, 'a0a1'), null); // legal-format, not in set
  assert.equal(legalMoveForUci(legal, 'h3e3'), null); // our coords, not Pikafish coords
  assert.equal(legalMoveForUci(legal, 'garbage'), null);
  assert.equal(legalMoveForUci(legal, ''), null);
});

// ── Ladder tier-table invariants ────────────────────────────────────────────

test('xiangqi ladder exposes exactly eight levels with unique level-N ids', () => {
  assert.equal(XIANGQI_PLAYABLE_ENGINES.length, 8);
  const ids = XIANGQI_PLAYABLE_ENGINES.map((tier) => tier.id);
  assert.equal(new Set(ids).size, ids.length, 'tier ids must be unique');
  ids.forEach((id, index) => {
    assert.equal(id, `pikafish-xiangqi-level-${index + 1}`);
  });
});

test('xiangqi ladder parameters are within range and monotonic', () => {
  for (const tier of XIANGQI_PLAYABLE_ENGINES) {
    assert.ok(tier.nodes >= 1, `${tier.id}: node budget must be positive`);
    assert.ok(tier.movetimeMs >= 1, `${tier.id}: movetime must be positive`);
  }
  for (let i = 1; i < XIANGQI_PLAYABLE_ENGINES.length; i++) {
    const prev = XIANGQI_PLAYABLE_ENGINES[i - 1]!;
    const next = XIANGQI_PLAYABLE_ENGINES[i]!;
    // Nodes are Pikafish's only configured strength control; movetime never regresses.
    assert.ok(next.nodes > prev.nodes, `${next.id}: nodes must exceed ${prev.id}`);
    assert.ok(
      next.movetimeMs >= prev.movetimeMs,
      `${next.id}: movetime must not regress from ${prev.id}`,
    );
  }
});

test('xiangqi default engine is the playable 100k-node level', () => {
  const tier = XIANGQI_PLAYABLE_ENGINES.find((entry) => entry.id === XIANGQI_DEFAULT_ENGINE_ID);
  assert.ok(tier, 'default engine id must be in XIANGQI_PLAYABLE_ENGINES');
  assert.equal(tier.nodes, 100_000);
});

test('xiangqi engine catalog exposes the honest FSF human ladder', () => {
  const fsf = XIANGQI_ENGINE_CATALOG.find(
    (entry) => entry.id === 'fairy-stockfish-xiangqi-level-1',
  );
  assert.deepEqual(fsf, {
    id: 'fairy-stockfish-xiangqi-level-1',
    name: 'Fairy-Stockfish Level 1',
    skill: -9,
    depth: 5,
    movetimeMs: 50,
  });
  assert.equal(isCatalogXiangqiEngineClientId(fsf?.id), true);
  assert.equal(catalogXiangqiEngineVersion(fsf?.id), '0.2.0');
  assert.equal(
    XIANGQI_ENGINE_CATALOG.filter((entry) => entry.id.startsWith('fairy-stockfish-xiangqi-level-'))
      .length,
    8,
  );
});

test('xiangqi public catalog exposes the FSF ladder plus one elite Pikafish challenge', () => {
  assert.deepEqual(
    XIANGQI_PUBLIC_ENGINES.map(({ id, name }) => ({ id, name })),
    [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `fairy-stockfish-xiangqi-level-${index + 1}`,
        name: `Fairy-Stockfish Level ${index + 1}`,
      })),
      { id: 'pikafish-xiangqi-level-8', name: 'Pikafish' },
    ],
  );
  assert.equal(XIANGQI_PUBLIC_DEFAULT_ENGINE_ID, 'fairy-stockfish-xiangqi-level-4');
  assert.ok(
    XIANGQI_PUBLIC_ENGINES.some((engine) => engine.id === XIANGQI_PUBLIC_DEFAULT_ENGINE_ID),
  );
  for (let level = 1; level < 8; level += 1) {
    const hiddenId = `pikafish-xiangqi-level-${level}`;
    assert.equal(
      XIANGQI_PUBLIC_ENGINES.some((engine) => engine.id === hiddenId),
      false,
    );
    assert.equal(isCatalogXiangqiEngineClientId(hiddenId), true);
  }
});

// ── Retired-tier back-compat ────────────────────────────────────────────────
// Finished prod PvE games, replays, and bot-profile attribution reference the
// pre-ladder ids. They must resolve (with their original parameters) without
// being offered in the picker.

test('retired xiangqi engine ids stay resolvable with their original parameters', () => {
  const expected = [
    { id: 'pikafish-xiangqi-amateur', nodes: 20_000, movetimeMs: 400 },
    { id: 'pikafish-xiangqi-strong', nodes: 300_000, movetimeMs: 1_500 },
    { id: 'pikafish-xiangqi-strongest', nodes: 3_000_000, movetimeMs: 4_000 },
  ];
  assert.deepEqual(
    XIANGQI_LEGACY_ENGINE_TIERS.map(({ id, nodes, movetimeMs }) => ({
      id,
      nodes,
      movetimeMs,
    })),
    expected,
  );
  for (const legacy of expected) {
    const tier = xiangqiEngineTierFor(legacy.id);
    assert.ok(tier, `${legacy.id} must resolve via xiangqiEngineTierFor`);
    assert.equal(tier.nodes, legacy.nodes);
    assert.equal(tier.movetimeMs, legacy.movetimeMs);
    assert.equal(isXiangqiEngineClientId(legacy.id), true);
    assert.equal(typeof xiangqiEngineVersion(legacy.id), 'string');
    assert.notEqual(xiangqiEngineDisplayName(legacy.id), legacy.id, 'display name must resolve');
    assert.ok(
      !XIANGQI_PLAYABLE_ENGINES.some((entry) => entry.id === legacy.id),
      `${legacy.id} must not be offered as a playable engine`,
    );
  }
});

// ── Per-move decision artifact ──────────────────────────────────────────────
// The payload is what a "why did the bot play that" investigation reads first,
// so the fields that distinguish "movetime ceiling bound on a slow box" from
// "node anchor bound as designed" must survive exactly.

test('decision payload records the tier contract and the search that actually ran', () => {
  const payload = buildXiangqiEngineDecisionPayload({
    engineId: 'fairy-stockfish-xiangqi-level-8',
    engineVersion: '0.2.0',
    seat: 'red',
    ply: 0,
    movetimeMs: 6_000,
    remainingMs: 179_000,
    incrementMs: 2_000,
    tier: {
      id: 'fairy-stockfish-xiangqi-level-8',
      name: 'Fairy-Stockfish Level 8',
      skill: 20,
      nodes: 1_000_000,
      movetimeMs: 6_000,
      hashMb: 64,
      nnue: true,
    },
    search: {
      best: 'h2e2',
      cp: 46,
      mate: null,
      depth: 20,
      nodes: 1_000_785,
      timeMs: 1_412,
      pv: ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b9c7', 'b0c2', 'a9a8', 'c3c4', 'c6c5'],
    },
    thinkTimeMs: 1_650,
    attempts: [{ attempt: 1, uci: 'h2e2', error: null, reason: null }],
    move: 'h2e2',
    guardReplaced: false,
  });
  assert.equal(payload.variant, 'xiangqi');
  assert.equal(payload.engine_seat, 'red');
  assert.equal(payload.move, 'h2e2');
  assert.equal(payload.failed_closed, false);
  assert.equal(payload.attempts, 1);
  assert.equal(payload.reject_reason, null);
  assert.deepEqual(payload.tier, {
    skill: 20,
    depth: null,
    nodes: 1_000_000,
    movetime_ms: 6_000,
    hash_mb: 64,
    nnue: true,
  });
  assert.deepEqual(payload.search, {
    depth: 20,
    nodes: 1_000_785,
    time_ms: 1_412,
    cp: 46,
    mate: null,
    // Capped so the artifact stays small; eight plies read the plan.
    pv: ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b9c7', 'b0c2', 'a9a8'],
  });
});

test('decision payload marks a fail-closed turn and a guard replacement', () => {
  const failed = buildXiangqiEngineDecisionPayload({
    engineId: 'pikafish-xiangqi-level-8',
    engineVersion: '0.3.0',
    seat: 'black',
    ply: 11,
    movetimeMs: 4_000,
    remainingMs: null,
    incrementMs: 0,
    tier: { id: 'pikafish-xiangqi-level-8', name: 'Pikafish', nodes: 3_000_000, movetimeMs: 4_000 },
    search: null,
    thinkTimeMs: 8_100,
    attempts: [
      { attempt: 1, uci: null, error: 'pikafish-xiangqi move timed out', reason: 'request-failed' },
      { attempt: 2, uci: null, error: 'pikafish-xiangqi move timed out', reason: 'request-failed' },
    ],
    move: null,
    guardReplaced: false,
  });
  assert.equal(failed.failed_closed, true);
  assert.equal(failed.move, null);
  assert.equal(failed.engine_move, null);
  assert.equal(failed.search, null);
  assert.equal(failed.attempts, 2);
  assert.equal(failed.reject_reason, 'request-failed');
  // A Pikafish tier has no skill/depth/net: those read as null/false, not undefined,
  // so the JSON column has the same shape for every engine family.
  assert.deepEqual(failed.tier, {
    skill: null,
    depth: null,
    nodes: 3_000_000,
    movetime_ms: 4_000,
    hash_mb: null,
    nnue: false,
  });

  const guarded = buildXiangqiEngineDecisionPayload({
    engineId: 'fairy-stockfish-xiangqi-level-3',
    engineVersion: '0.2.0',
    seat: 'red',
    ply: 20,
    movetimeMs: 150,
    remainingMs: 60_000,
    incrementMs: 0,
    tier: {
      id: 'fairy-stockfish-xiangqi-level-3',
      name: 'Fairy-Stockfish Level 3',
      skill: -1,
      depth: 5,
      movetimeMs: 150,
    },
    search: { best: 'e3e4', cp: -120, mate: null, depth: 5 },
    thinkTimeMs: 300,
    attempts: [{ attempt: 1, uci: 'e3e4', error: null, reason: null }],
    move: 'a0a1',
    guardReplaced: true,
  });
  assert.equal(guarded.engine_move, 'e3e4', 'what the engine wanted');
  assert.equal(guarded.move, 'a0a1', 'what was played');
  assert.equal(guarded.guard_replaced, true);
  assert.deepEqual(guarded.search, {
    depth: 5,
    nodes: null,
    time_ms: null,
    cp: -120,
    mate: null,
    pv: [],
  });
});

test('xiangqi decisions queue on the room for the game-end flush, in the artifact shape', () => {
  // Written at move time they violate the games FK (xiangqi has no games row
  // until game end), so the loop queues and the tenant event writer flushes.
  // The queue itself is shared; this pins the shape a xiangqi decision lands in.
  const room: { id: string; pendingDebugArtifacts?: unknown[] } = { id: 'xq_queue' };
  queueEngineDecision(room as never, { ply: 0, move: 'h2e2' });
  queueEngineDecision(room as never, { ply: 2, move: 'h0g2' });
  assert.deepEqual(room.pendingDebugArtifacts, [
    {
      gameId: 'xq_queue',
      ply: 0,
      engineColor: null,
      artifactType: 'live-engine-decision',
      payload: { ply: 0, move: 'h2e2' },
    },
    {
      gameId: 'xq_queue',
      ply: 2,
      engineColor: null,
      artifactType: 'live-engine-decision',
      payload: { ply: 2, move: 'h0g2' },
    },
  ]);
});
