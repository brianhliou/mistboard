import { threeKingdomsBanqiLiveWatchPayloadFor } from './routes/three-kingdoms-banqi-games.js';
import './three-kingdoms-banqi-registration.js';
import { resolvePositionOg } from './og-position.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';
/**
 * Three Kingdoms banqi (#628) hidden-information regression: two rooms whose
 * deals differ only by swapping two tiles that are still face down must look
 * byte-identical to every client and to the engine. Covers the whole join
 * payload (snapshot, event log, live history) for both seats and a spectator,
 * and the engine request (FEN, window moves, the exact stdin block) at every
 * ply of a line with flips, quiet moves and captures.
 *
 * The truth view is the planted failure: it MUST differ between the two rooms,
 * so the swap is real and a payload that carried the deal would be caught.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyThreeKingdomsBanqiMove,
  type BanqiDeal,
  type BanqiSeat,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiState,
} from '@mistboard/game';
import {
  playThreeKingdomsBanqiEngineMoveIfReady,
  threeKingdomsBanqiEngineRequestFor,
} from './server-three-kingdoms-banqi-engine.js';
import {
  buildThreeKingdomsBanqiEngineCommands,
  THREE_KINGDOMS_BANQI_ENGINE_ID,
  type ThreeKingdomsBanqiEngineRequest,
} from './three-kingdoms-banqi-engine.js';
import {
  getThreeKingdomsBanqiTruthView,
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import {
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED = 'true';

const ROOM = 'tkb_hidden';
const BUDGET = { nodes: 1000, movetimeCapMs: 500 };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function header(deal: BanqiDeal): ThreeKingdomsBanqiEvent[] {
  return [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM,
      gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
      setup: { deal },
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM, clientId: 'human', seat: 'red' },
    {
      type: 'seat-assigned',
      at: 3,
      roomId: ROOM,
      clientId: THREE_KINGDOMS_BANQI_ENGINE_ID,
      seat: 'black',
    },
  ];
}

// A deterministic line that takes every capture, plays quiet moves often (so the
// engine's repetition window is non-empty) and flips otherwise.
function playLine(deal: BanqiDeal): {
  moves: ThreeKingdomsBanqiMove[];
  final: ThreeKingdomsBanqiState;
} {
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal });
  const moves: ThreeKingdomsBanqiMove[] = [];
  for (let ply = 0; ply < 48 && state.status.type === 'playing'; ply += 1) {
    const legal = getThreeKingdomsBanqiLegalMoves(state);
    const captures = legal.filter((m) => m.from !== m.to && state.board[m.to]);
    const quiet = legal.filter((m) => m.from !== m.to && !state.board[m.to]);
    const flips = legal.filter((m) => m.from === m.to);
    const move =
      captures[0] ??
      (ply % 4 !== 0 && quiet.length > 0 ? quiet[(ply * 7) % quiet.length] : undefined) ??
      flips[(ply * 5) % Math.max(flips.length, 1)] ??
      legal[0]!;
    moves.push(move);
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  return { moves, final: state };
}

function eventsFor(deal: BanqiDeal, moves: readonly ThreeKingdomsBanqiMove[]) {
  const events = header(deal);
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal });
  let at = 10;
  for (const move of moves) {
    if (state.status.type !== 'playing') break;
    events.push({ type: 'move-played', at: at++, roomId: ROOM, color: state.status.turn, move });
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  return events;
}

// Everything a joining client receives, minus the wall clock.
function joinPayload(events: readonly ThreeKingdomsBanqiEvent[], seat: BanqiSeat | 'spectator') {
  const hydrated = createTenantRuntimeRoomFromEvents(threeKingdomsBanqiTenant, events);
  if (!hydrated.ok) throw new Error(hydrated.error);
  const room = hydrated.room;
  const client = { id: `c-${seat}`, seat, solo: false } as const;
  const { serverAt: _clock, ...snapshot } = tenantSnapshotPayload(
    threeKingdomsBanqiTenant,
    room,
    client,
  );
  return JSON.stringify({
    snapshot,
    events: tenantEventsForClient(threeKingdomsBanqiTenant, room, client),
    ...tenantLiveHistoryExtras(threeKingdomsBanqiTenant, room, client),
  });
}

function engineRequest(events: readonly ThreeKingdomsBanqiEvent[]) {
  const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
  const request = threeKingdomsBanqiEngineRequestFor(events, state, BUDGET);
  return { request, commands: buildThreeKingdomsBanqiEngineCommands(request).join('\n') };
}

const dealA = createThreeKingdomsBanqiSetup(seeded(628)).deal;
const { moves, final } = playLine(dealA);

// Two tiles still face down at the end, holding different pieces.
const coveredIdx = THREE_KINGDOMS_BANQI_SETUP_SQUARES.flatMap((sq, i) =>
  final.board[sq]?.faceDown ? [i] : [],
);
const i = coveredIdx[0]!;
const j = coveredIdx.find(
  (k) => dealA[k]!.color !== dealA[i]!.color || dealA[k]!.role !== dealA[i]!.role,
)!;
const dealB = [...dealA];
[dealB[i], dealB[j]] = [dealA[j]!, dealA[i]!];
const eventsA = eventsFor(dealA, moves);
const eventsB = eventsFor(dealB, moves);
const moveEventCount = eventsA.length - 3;

test('the scripted line exercises flips, quiet windows and captures, and keeps tiles covered', () => {
  assert.ok(j !== undefined, 'two different covered tiles to swap');
  assert.ok(moveEventCount >= 20, `a long line (${moveEventCount} plies)`);
  assert.equal(eventsB.length, eventsA.length, 'the swap leaves the same line legal');
  const finalA = replayTenantEvents(threeKingdomsBanqiTenant, eventsA).state;
  assert.ok(finalA.captures.length > 0, 'the line captures');
  const windows = Array.from(
    { length: moveEventCount + 1 },
    (_, n) => engineRequest(eventsA.slice(0, 3 + n)).request.moves.length,
  );
  assert.ok(
    windows.some((w) => w > 0),
    'some engine request carries a repetition window',
  );
});

test('the truth differs between the two deals (the planted difference is real)', () => {
  const truth = (events: readonly ThreeKingdomsBanqiEvent[]) =>
    JSON.stringify(
      getThreeKingdomsBanqiTruthView(replayTenantEvents(threeKingdomsBanqiTenant, events).state),
    );
  assert.notEqual(truth(eventsA), truth(eventsB));
  // And the server-side event logs differ: the deal is in room-created.
  assert.notDeepEqual(eventsA[0], eventsB[0]);
});

test('every client payload is identical under a swap of two face-down tiles, at every ply', () => {
  for (let n = 0; n <= moveEventCount; n += 1) {
    for (const seat of ['red', 'black', 'spectator'] as const) {
      const a = joinPayload(eventsA.slice(0, 3 + n), seat);
      const b = joinPayload(eventsB.slice(0, 3 + n), seat);
      assert.equal(a, b, `${seat} payload after ${n} plies leaks a face-down identity`);
      assert.ok(!a.includes('"setup"'), 'the deal never reaches a client');
    }
  }
});

test('the engine request is identical under the same swap, at every ply', () => {
  for (let n = 0; n <= moveEventCount; n += 1) {
    const a = engineRequest(eventsA.slice(0, 3 + n));
    const b = engineRequest(eventsB.slice(0, 3 + n));
    assert.equal(a.commands, b.commands, `engine stdin after ${n} plies leaks an identity`);
  }
});

test('the live PvE turn hands the provider that same redacted request and plays its move', async () => {
  // The last prefix with the engine (black) on turn.
  let n = moveEventCount;
  const turnAt = (k: number) =>
    replayTenantEvents(threeKingdomsBanqiTenant, eventsA.slice(0, 3 + k)).state.status;
  while (n > 0) {
    const status = turnAt(n);
    if (status.type === 'playing' && status.turn === 'black') break;
    n -= 1;
  }
  const seen: Record<'a' | 'b', ThreeKingdomsBanqiEngineRequest | null> = { a: null, b: null };
  const appended: Record<'a' | 'b', ThreeKingdomsBanqiEvent[]> = { a: [], b: [] };
  for (const [key, events] of [
    ['a', eventsA.slice(0, 3 + n)],
    ['b', eventsB.slice(0, 3 + n)],
  ] as const) {
    const hydrated = createTenantRuntimeRoomFromEvents(threeKingdomsBanqiTenant, events);
    if (!hydrated.ok) throw new Error(hydrated.error);
    const state = hydrated.room.projection.state;
    const legal = getThreeKingdomsBanqiLegalMoves(state)[0]!;
    const ctx = {
      now: () => 100,
      appendEvent: async (_room: unknown, event: ThreeKingdomsBanqiEvent) => {
        appended[key].push(event);
        return events.length + 1;
      },
      broadcastEventAppended: () => {},
    };
    await playThreeKingdomsBanqiEngineMoveIfReady(
      ctx as never,
      hydrated.room as never,
      async (request) => {
        seen[key] = request;
        return { best: `${legal.from}${legal.to}`, cp: 0, mate: null, depth: 1 };
      },
    );
  }
  assert.ok(seen.a, 'the engine was asked');
  assert.equal(
    buildThreeKingdomsBanqiEngineCommands({ ...seen.a!, movetimeCapMs: 0 }).join('\n'),
    buildThreeKingdomsBanqiEngineCommands({ ...seen.b!, movetimeCapMs: 0 }).join('\n'),
  );
  assert.equal(appended.a.length, 1);
  assert.equal(appended.a[0]!.type, 'move-played');
});

test('finished room and history payloads keep covered identities masked for every recipient', () => {
  const finish = (events: readonly ThreeKingdomsBanqiEvent[]): ThreeKingdomsBanqiEvent[] => [
    ...events,
    { type: 'seat-resigned', at: 9_999, roomId: ROOM, color: 'red' },
  ];
  for (const seat of ['red', 'black', 'spectator'] as const) {
    const a = joinPayload(finish(eventsA), seat);
    const b = joinPayload(finish(eventsB), seat);
    assert.equal(a, b, `${seat}: whole finished payload is invariant under a hidden swap`);
    assert.doesNotMatch(a, /"setup"|"deal"/);
    assert.ok(Array.isArray(JSON.parse(a).liveHistory));
  }
});

// Registration parity must preserve the same hidden-information boundary.
test('the entire live TV frame is byte-identical under a covered-deal swap', () => {
  for (let n = 0; n <= moveEventCount; n += 1) {
    const frame = (events: readonly ThreeKingdomsBanqiEvent[]) => {
      const hydrated = createTenantRuntimeRoomFromEvents(threeKingdomsBanqiTenant, events);
      if (!hydrated.ok) throw new Error(hydrated.error);
      const payload = threeKingdomsBanqiLiveWatchPayloadFor(ROOM, hydrated.room);
      assert.ok(payload);
      return JSON.stringify(payload);
    };
    assert.equal(frame(eventsA.slice(0, 3 + n)), frame(eventsB.slice(0, 3 + n)));
  }
});

test('the whole final-position card is byte-identical under a covered-deal swap', () => {
  const payload = (events: readonly ThreeKingdomsBanqiEvent[]) => {
    const finished: ThreeKingdomsBanqiEvent[] = [
      ...events,
      { type: 'seat-resigned', at: 9999, roomId: ROOM, color: 'red' },
    ];
    const card = variantTenantForRoomId(ROOM)?.card;
    assert.ok(card && card.layout !== 'gomoku' && card.layout !== 'match');
    const fen = card.fenAtPly(finished, ROOM, moveEventCount);
    assert.ok(fen);
    const position = resolvePositionOg('three-kingdoms-banqi', fen);
    assert.ok(position);
    return JSON.stringify({
      variant: card.variant,
      analysis: card.analysis,
      fen,
      inks: card.seatInks?.(finished, ROOM),
      position,
    });
  };
  assert.equal(payload(eventsA), payload(eventsB));
});

test('an attempted face-down capture is rejected and reveals nothing to the opponent or spectator', () => {
  // TK rule 3 forbids capturing any covered tile. Check every attempt along
  // the real line, rather than manufacturing an impossible capture event.
  let attempts = 0;
  for (let n = 1; n <= moveEventCount; n += 1) {
    const events = eventsA.slice(0, 3 + n);
    const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
    for (const [from, mover] of Object.entries(state.board)) {
      if (!mover || mover.faceDown) continue;
      for (const [to, target] of Object.entries(state.board)) {
        if (!target?.faceDown) continue;
        const attempted = { from, to } as ThreeKingdomsBanqiMove;
        assert.equal(applyThreeKingdomsBanqiMove(state, attempted), state);
        for (const seat of ['red', 'black', 'spectator'] as const) {
          const raw = JSON.parse(joinPayload(events, seat));
          assert.deepEqual(raw.snapshot.state.board[to], { faceDown: true });
          assert.ok(!JSON.stringify(raw).includes('"setup"'));
        }
        attempts += 1;
        break;
      }
      break;
    }
  }
  assert.ok(attempts > 0);
});

test('registration offers rated Banqi time controls, TV, a card and the masked export', async () => {
  const registration = variantTenantForRoomId(ROOM)!;
  assert.equal(registration.lobby?.supportsRated, true);
  assert.equal(
    registration.lobby?.allowsTimeControl({ initialMs: 300000, incrementMs: 5000 }),
    true,
  );
  assert.equal(registration.lobby?.allowsTimeControl({ initialMs: 123, incrementMs: 0 }), false);
  assert.equal(registration.watch?.channelId, 'three-kingdoms-banqi');
  assert.equal(typeof registration.createCorrespondenceGameForSeek, 'function');
  // The export is built from the masked public views; its swap invariance is
  // pinned in three-kingdoms-banqi-export.test.ts.
  assert.equal(registration.export?.gameRouteBase, '/three-kingdoms-banqi/game');
});
