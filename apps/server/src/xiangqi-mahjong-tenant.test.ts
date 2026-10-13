import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createXmjSetup,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjRoomState,
  type XmjSeat,
} from '@mistboard/game';
import { gateGameSpecRequest } from './game-spec-request-gate.js';
import { isAllowlistedGameSpec } from './persistence-variant-access.js';
import {
  isXmjBotClientId,
  playXmjBotMove,
  XMJ_BOT_CLIENT_ID,
} from './server-xiangqi-mahjong-bots.js';
import {
  getXmjClientView,
  type XmjEvent,
  xiangqiMahjongTenant,
  xmjClientEventFor,
} from './xiangqi-mahjong-tenant.js';

const tenant = xiangqiMahjongTenant;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newState(seed: number): XmjRoomState {
  return tenant.rules.createInitialState('xmj_test', createXmjSetup(seeded(seed)));
}

test('gated twice: the flag is off by default and the spec needs a grant', () => {
  const previous = process.env.MISTBOARD_XIANGQI_MAHJONG_ENABLED;
  delete process.env.MISTBOARD_XIANGQI_MAHJONG_ENABLED;
  try {
    assert.equal(tenant.enabled(), false);
    const decision = gateGameSpecRequest({ gameSpecId: XIANGQI_MAHJONG_SPEC_ID });
    assert.equal(decision.type === 'reject' && decision.error, 'xiangqi_mahjong_disabled');
  } finally {
    if (previous !== undefined) process.env.MISTBOARD_XIANGQI_MAHJONG_ENABLED = previous;
  }
  assert.equal(isAllowlistedGameSpec(XIANGQI_MAHJONG_SPEC_ID), true);
});

test('a room with no persisted walls refuses to start rather than dealing fresh ones', () => {
  assert.throws(() => tenant.rules.createInitialState('xmj_x'), /no persisted walls/);
  assert.throws(
    () => tenant.rules.createInitialState('xmj_x', { walls: [] }),
    /no persisted walls/,
  );
});

test('the walls never reach a client', () => {
  const setup = tenant.rules.createSetup?.();
  assert.ok(setup);
  const event = {
    type: 'room-created',
    at: 1,
    roomId: 'xmj_test',
    gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
    setup,
  } as unknown as XmjEvent;
  const out = xmjClientEventFor(event, 'east', 0) as Record<string, unknown>;
  assert.equal('setup' in out, false);
  assert.equal(JSON.stringify(out).includes('walls'), false);
});

test('a player view hides the other hand while the hand is live', () => {
  const state = newState(3);
  const view = getXmjClientView(state, { seat: 'east' } as never);
  assert.ok(view.hands.east);
  assert.equal(view.hands.west, null);
  const spectator = getXmjClientView(state, { seat: 'spectator' } as never);
  assert.equal(spectator.hands.east, null);
  assert.equal(spectator.hands.west, null);
});

test('canonicalMove stamps the socket seat and refuses a seat out of turn', () => {
  const state = newState(4);
  assert.equal(state.status.type, 'playing');
  if (state.status.type !== 'playing') return;
  const toMove = state.status.turn;
  const idle: XmjSeat = toMove === 'east' ? 'west' : 'east';
  const view = getXmjClientView(state, { seat: toMove } as never);
  const tile = view.legal.discard[0];
  assert.ok(tile);
  const parsed = tenant.rules.moveFromMessage({ action: 'discard', tiles: [tile] });
  assert.ok(parsed);
  const stamped = tenant.rules.canonicalMove?.(state, parsed, toMove);
  assert.equal(stamped?.by, toMove);
  assert.equal(tenant.rules.canonicalMove?.(state, parsed, idle), null);
  assert.equal(tenant.rules.moveFromMessage({ action: 'timeout' }), null);
});

test('two bots play a whole match to a recordable finish', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    let state = newState(seed);
    for (let step = 0; step < 2000 && state.status.type === 'playing'; step += 1) {
      const before = state;
      for (const seat of tenant.colors) state = playXmjBotMove(state, seat);
      if (state === before) {
        // Nobody had an action: the only thing left is a deadline.
        const pending = tenant.rules.pendingAction?.(state);
        assert.ok(pending, `stuck at move ${state.moveNumber}`);
        state = tenant.rules.applyMove(state, pending.move);
      }
    }
    assert.equal(state.status.type, 'finished');
    if (state.status.type !== 'finished') continue;
    const result = tenant.persistence.resultForWinner(state.status.winner);
    assert.ok(['east-wins', 'west-wins', 'draw'].includes(result));
    assert.ok(['checkmate', 'draw'].includes(tenant.persistence.termination(state.status.reason)));
  }
});

test('every runtime ending maps to a termination, and an unknown one throws', () => {
  for (const reason of ['points', 'tie', 'timeout', 'resignation', 'abandonment']) {
    assert.ok(tenant.persistence.termination(reason));
  }
  assert.throws(() => tenant.persistence.termination('exhausted'), /unmapped/);
});

test('the bot seat is an engine seat, so it never reads as a disconnected player', () => {
  assert.equal(isXmjBotClientId(XMJ_BOT_CLIENT_ID), true);
  assert.equal(tenant.engine?.isEngineClientId(XMJ_BOT_CLIENT_ID), true);
  assert.equal(tenant.engine?.isEngineClientId('some-human'), false);
  assert.equal(tenant.oppositeColor('east'), 'west');
});
