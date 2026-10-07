/**
 * Jieqi threefold repetition and the perpetual-check loss, through the tenant
 * and the generic runtime: the verdict a live room reaches is the verdict event
 * replay reaches, rooms created before the rule replay to the end they had, and
 * the repetition bookkeeping (keyed on true identities) never reaches a client.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInitialJieqiState,
  JIEQI_SPEC_ID,
  type JieqiDeal,
  type JieqiMove,
  type JieqiPieceRole,
} from '@mistboard/game';
import {
  enforcesRepetition,
  getJieqiClientView,
  getJieqiTruthView,
  jieqiClientEventFor,
  jieqiTenant,
} from './jieqi-tenant.js';
import { createTenantRuntimeRoom, replayTenantEvents } from './variant-tenant/runtime.js';
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
