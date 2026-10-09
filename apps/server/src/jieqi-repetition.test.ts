/**
 * Jieqi threefold repetition and the perpetual-check loss, through the tenant
 * and the generic runtime: the verdict a live room reaches is the verdict event
 * replay reaches, rooms created before the rule replay to the end they had, and
 * the repetition bookkeeping (keyed on true identities) never reaches a client.
 * Then the bots' draw guard: a bot scoring a win does not walk into these draws.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInitialJieqiState,
  DEFAULT_NO_CAPTURE_PLY_LIMIT,
  getJieqiLegalMoves,
  JIEQI_SPEC_ID,
  type JieqiDeal,
  type JieqiMove,
  type JieqiPieceRole,
  jieqiMoveToPikafishUci,
} from '@mistboard/game';
import { guardJieqiRuleEnding, jieqiRuleEndingRisk } from './jieqi-draw-guard.js';
import { JIEQI_ABJCHESS_ENGINE_ID } from './jieqi-engine.js';
import {
  enforcesRepetition,
  getJieqiClientView,
  getJieqiTruthView,
  jieqiClientEventFor,
  jieqiTenant,
} from './jieqi-tenant.js';
import { playJieqiEngineMoveIfReady } from './server-jieqi-engine.js';
import type { UciEval } from './uci-engine-harness.js';
import {
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
} from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

process.env.MISTBOARD_JIEQI_ENABLED = 'true';

type JieqiRoomEvent = TenantRoomEvent<'red' | 'black', JieqiMove, typeof JIEQI_SPEC_ID>;

// mistboard.com/jieqi/game/jq_e6ba8d8a-00f1-4c27-a024-66474a5f4290: after red's
// Ke1-d1 (ply 27), black, a rook up on the king's rank, could check forever with
// Rb1+ Kd2 Rb2+ Kd1. Before the rule that ran to the 120-ply no-capture draw.
const roles = (line: string) => line.split(' ') as JieqiPieceRole[];
const EXAMPLE_DEAL: JieqiDeal = {
  red: roles(
    'soldier elephant chariot soldier horse soldier cannon soldier soldier chariot horse cannon advisor elephant advisor',
  ),
  black: roles(
    'horse soldier soldier soldier chariot advisor soldier cannon cannon elephant chariot soldier advisor horse elephant',
  ),
};
const EXAMPLE_OPENING =
  'c4-c5 c10-e8 b3-b6 i7-i6 b1-c3 h8-h1 c5-a5 b10-a8 a5-a8 a10-a8 h3-h9 h1-g1 h9-a9 a8-a4 ' +
  'a1-a4 g1-f1 i1-f1 i6-i4 e4-e5 i4-g4 d1-e2 g4-c4 c1-e3 c4-a4 e3-d3 a4-b4 e1-d1';
const EXAMPLE_PERPETUAL = 'b4-b1 d1-d2 b1-b2 d2-d1 b2-b1 d1-d2 b1-b2 d2-d1 b2-b1';

function roomEvents(roomId: string, setup: unknown, line: string): JieqiRoomEvent[] {
  const events: JieqiRoomEvent[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: JIEQI_SPEC_ID, setup },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
  let at = 4;
  line.split(' ').forEach((token, index) => {
    const [from, to] = token.split('-');
    events.push({
      type: 'move-played',
      at: at++,
      roomId,
      color: index % 2 === 0 ? 'red' : 'black',
      move: { from, to } as JieqiMove,
    });
  });
  return events;
}

const MARKED_SETUP = { ...EXAMPLE_DEAL, repetition: true };

test('new rooms carry the repetition marker in their secret setup', () => {
  const created = createTenantRuntimeRoom(jieqiTenant, 'jq_marker', { now: 1 });
  if (!created.ok) throw new Error(created.error);
  const event = created.room.events[0];
  if (event.type !== 'room-created') throw new Error('expected room-created first');
  assert.equal((event.setup as { repetition?: unknown }).repetition, true);
  assert.ok(created.room.projection.state.positionCounts, 'the new room enforces repetition');
  // The setup, marker included, is still stripped for every seat.
  for (const seat of ['red', 'black', 'spectator'] as const) {
    const clientEvent = jieqiClientEventFor(event, seat, 0);
    assert.ok(clientEvent && !('setup' in clientEvent));
  }
});

test('the example game: the perpetual checker (black) loses by chasing', () => {
  const events = roomEvents('jq_example', MARKED_SETUP, `${EXAMPLE_OPENING} ${EXAMPLE_PERPETUAL}`);
  const projection = replayTenantEvents(jieqiTenant, events);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'chasing',
  });
  assert.equal(jieqiTenant.persistence.termination('chasing'), 'chasing');
  assert.equal(jieqiTenant.persistence.resultForWinner('red'), 'red-wins');
});

test('replaying the event history gives the same verdict as playing it move by move', () => {
  const events = roomEvents('jq_live', MARKED_SETUP, `${EXAMPLE_OPENING} ${EXAMPLE_PERPETUAL}`);
  // Live path: the tenant's applyMove, one move at a time.
  let state = jieqiTenant.rules.createInitialState('jq_live', MARKED_SETUP);
  for (const event of events) {
    if (event.type === 'move-played') state = jieqiTenant.rules.applyMove(state, event.move);
  }
  const replayed = replayTenantEvents(jieqiTenant, events);
  assert.deepEqual(replayed.state, state);
  // Moves after the end are ignored on replay, so a stray late event cannot
  // reopen the game.
  const late = roomEvents('jq_live', MARKED_SETUP, `${EXAMPLE_OPENING} ${EXAMPLE_PERPETUAL} d1-d2`);
  assert.deepEqual(replayTenantEvents(jieqiTenant, late).state.status, state.status);
});

test('a room created before the rule replays past the repetition to the end it had', () => {
  // Legacy setup: the bare deal, no marker.
  assert.equal(enforcesRepetition(EXAMPLE_DEAL), false);
  const events = roomEvents(
    'jq_legacy',
    EXAMPLE_DEAL,
    `${EXAMPLE_OPENING} ${EXAMPLE_PERPETUAL} d1-d2 b1-b2 d2-d1`,
  );
  const projection = replayTenantEvents(jieqiTenant, events);
  assert.equal(projection.state.status.type, 'playing');
  assert.equal(projection.state.positionCounts, undefined);
});

test('hidden info: no client view carries the repetition bookkeeping', () => {
  // Mid-game, with dark pieces still on the board and in the position keys.
  const events = roomEvents('jq_leak', MARKED_SETUP, 'c4-c5 c10-e8 c5-c4 e8-c10 c4-c5');
  const state = replayTenantEvents(jieqiTenant, events).state;
  assert.ok(state.positionCounts && Object.keys(state.positionCounts).length > 0);
  const keys = Object.keys(state.positionCounts);
  for (const seat of ['red', 'black', 'spectator'] as const) {
    const wire = JSON.stringify(getJieqiClientView(state, { id: 'c', seat, solo: false }));
    assert.ok(!wire.includes('positionCounts') && !wire.includes('repetitionLog'), seat);
    for (const key of keys) assert.ok(!wire.includes(key), `${seat} saw a position key`);
  }
  const truth = JSON.stringify(getJieqiTruthView(state));
  assert.ok(!truth.includes('positionCounts') && !truth.includes('repetitionLog'));
});

test('the kernel default (no marker, no setup flag) matches the tenant for a missing setup', () => {
  // A missing setup is the standard deal under the current rule.
  assert.equal(enforcesRepetition(undefined), true);
  const fromTenant = jieqiTenant.rules.createInitialState('jq_none', undefined);
  const fromKernel = createInitialJieqiState('jq_none', undefined, { repetition: true });
  assert.deepEqual(fromTenant, fromKernel);
});

// ── The draw guard (jieqi-draw-guard.ts) ────────────────────────────────────
//
// The engines search under xiangqi's chase rule, where the side repeating a
// chase loses; ours draws it. On 10-06 and 10-07 AB-JChess drew four games it
// scored as mate in 1 or +300, each completed by the human's reply. After the
// example opening, black's e8-g6 and red's b6-a6 shuffle with no check.
const SHUFFLE = 'e8-g6 b6-a6 g6-e8 a6-b6 e8-g6 b6-a6';
const toUci = (token: string) => {
  const [from, to] = token.split('-');
  return jieqiMoveToPikafishUci({ from, to } as JieqiMove);
};
const engineSays = (best: string, score: { cp?: number; mate?: number }): UciEval => ({
  best,
  cp: score.cp ?? null,
  mate: score.mate ?? null,
  depth: 20,
});

function stateAfter(line: string) {
  return replayTenantEvents(jieqiTenant, roomEvents('jq_guard', MARKED_SETUP, line)).state;
}

test('the guard knows a shuffle the human can close as a draw by repetition', () => {
  const state = stateAfter(`${EXAMPLE_OPENING} ${SHUFFLE}`);
  assert.equal(state.status.type, 'playing');
  assert.deepEqual(jieqiRuleEndingRisk(state, { from: 'g6', to: 'e8' } as JieqiMove), {
    outcome: 'draw',
    reason: 'repetition',
    via: 'reply',
  });
  // The same move one cycle earlier closes nothing yet.
  const earlier = stateAfter(`${EXAMPLE_OPENING} e8-g6 b6-a6`);
  assert.equal(jieqiRuleEndingRisk(earlier, { from: 'g6', to: 'e8' } as JieqiMove), null);
  // The bot's own move completing the threefold (red to move, a6-b6).
  const own = stateAfter(`${EXAMPLE_OPENING} ${SHUFFLE} g6-e8`);
  assert.deepEqual(jieqiRuleEndingRisk(own, { from: 'a6', to: 'b6' } as JieqiMove), {
    outcome: 'draw',
    reason: 'repetition',
    via: 'move',
  });
});

test('a winning bot does not step into the repetition: it re-searches without it', async () => {
  const state = stateAfter(`${EXAMPLE_OPENING} ${SHUFFLE}`);
  const searched: (readonly string[])[] = [];
  const result = await guardJieqiRuleEnding({
    state,
    search: engineSays(toUci('g6-e8'), { mate: 1 }),
    research: async (searchMoves) => {
      searched.push(searchMoves);
      return engineSays(toUci('a7-a6'), { cp: 240 });
    },
  });
  assert.equal(searched.length, 1, 'one re-search');
  assert.ok(!searched[0]!.includes(toUci('g6-e8')), 'the drawing move is excluded');
  assert.ok(searched[0]!.includes(toUci('a7-a6')));
  assert.equal(result.best, toUci('a7-a6'));
  assert.equal(result.replaced, true);
  assert.equal(result.reason, 'avoided-draw');
  assert.equal(result.detail?.engine_move, toUci('g6-e8'));
});

test('a bot that is not winning takes the repetition, and no re-search runs', async () => {
  const state = stateAfter(`${EXAMPLE_OPENING} ${SHUFFLE}`);
  for (const score of [{ cp: 0 }, { cp: -80 }, { cp: 150 }, { mate: -3 }]) {
    let researched = false;
    const result = await guardJieqiRuleEnding({
      state,
      search: engineSays(toUci('g6-e8'), score),
      research: async () => {
        researched = true;
        return engineSays(toUci('a7-a6'), { cp: 0 });
      },
    });
    assert.equal(researched, false, JSON.stringify(score));
    assert.equal(result.best, toUci('g6-e8'));
    assert.equal(result.reason, null);
  }
});

test('the draw stands when every alternative is clearly worse than it', async () => {
  const state = stateAfter(`${EXAMPLE_OPENING} ${SHUFFLE}`);
  const result = await guardJieqiRuleEnding({
    state,
    search: engineSays(toUci('g6-e8'), { cp: 324 }),
    research: async () => engineSays(toUci('a7-a6'), { cp: -400 }),
  });
  assert.equal(result.best, toUci('g6-e8'));
  assert.equal(result.replaced, false);
  assert.equal(result.reason, 'kept-draw-alternatives-worse');
  // A failed re-search never costs the move either.
  const failed = await guardJieqiRuleEnding({
    state,
    search: engineSays(toUci('g6-e8'), { cp: 324 }),
    research: async () => {
      throw new Error('engine died');
    },
  });
  assert.equal(failed.best, toUci('g6-e8'));
  assert.equal(failed.reason, 'kept-research-failed');
});

test('near the no-capture limit a winning bot keeps only the moves that reset the clock', async () => {
  // The 10-06 draw: AB-JChess scored mate in 1 at clock 118 and played a quiet move;
  // any quiet reply then drew on the 120-ply clock.
  const base = stateAfter(`${EXAMPLE_OPENING} e8-g6 b6-a6`);
  const state = { ...base, noCaptureClock: DEFAULT_NO_CAPTURE_PLY_LIMIT - 2 };
  assert.deepEqual(jieqiRuleEndingRisk(state, { from: 'g6', to: 'e8' } as JieqiMove), {
    outcome: 'draw',
    reason: 'no-capture-clock',
    via: 'reply',
  });
  let allowed: readonly string[] = [];
  const result = await guardJieqiRuleEnding({
    state,
    search: engineSays(toUci('g6-e8'), { mate: 1 }),
    research: async (searchMoves) => {
      allowed = searchMoves;
      return engineSays(searchMoves[0]!, { cp: 300 });
    },
  });
  const captures = getJieqiLegalMoves(state)
    .filter((move) => state.board[move.to] !== undefined)
    .map(jieqiMoveToPikafishUci);
  assert.ok(captures.length > 0);
  assert.deepEqual([...allowed].sort(), [...captures].sort(), 'only captures avoid the clock');
  assert.equal(result.replaced, true);
  // One ply later the bot's own quiet move is the draw.
  const last = { ...base, noCaptureClock: DEFAULT_NO_CAPTURE_PLY_LIMIT - 1 };
  assert.deepEqual(jieqiRuleEndingRisk(last, { from: 'g6', to: 'e8' } as JieqiMove), {
    outcome: 'draw',
    reason: 'no-capture-clock',
    via: 'move',
  });
});

test('live: the served bot plays the re-searched move and the decision artifact says why', async () => {
  const roomId = 'jq_guard_live';
  const events: JieqiRoomEvent[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: JIEQI_SPEC_ID, setup: MARKED_SETUP },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'human', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: JIEQI_ABJCHESS_ENGINE_ID, seat: 'black' },
    ...roomEvents(roomId, MARKED_SETUP, `${EXAMPLE_OPENING} ${SHUFFLE}`).filter(
      (event) => event.type === 'move-played',
    ),
  ];
  const hydrated = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
  if (!hydrated.ok) throw new Error(hydrated.error);
  const room = hydrated.room as unknown as Parameters<typeof playJieqiEngineMoveIfReady>[1];
  const appended: JieqiRoomEvent[] = [];
  const ctx = {
    appendEvent: async (_room: unknown, event: JieqiRoomEvent) => {
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  } as unknown as Parameters<typeof playJieqiEngineMoveIfReady>[0];
  const calls: { searchMoves?: readonly string[] }[] = [];
  await playJieqiEngineMoveIfReady(ctx, room, async (_engineId, _fen, opts) => {
    calls.push(opts);
    return opts.searchMoves
      ? engineSays(toUci('a7-a6'), { cp: 260 })
      : engineSays(toUci('g6-e8'), { mate: 1 });
  });
  assert.equal(calls.length, 2, 'the search, then one re-search');
  assert.ok(calls[1]!.searchMoves && !calls[1]!.searchMoves.includes(toUci('g6-e8')));
  const played = appended.find((event) => event.type === 'move-played');
  assert.ok(played && played.type === 'move-played');
  assert.deepEqual(played.move, { from: 'a7', to: 'a6' });
  const decision = room.pendingDebugArtifacts?.at(-1)?.payload as Record<string, unknown>;
  assert.equal(decision.move, toUci('a7-a6'));
  assert.equal(decision.engine_move, toUci('g6-e8'));
  assert.equal(decision.guard_replaced, true);
  assert.equal(decision.guard_reason, 'avoided-draw');
});
