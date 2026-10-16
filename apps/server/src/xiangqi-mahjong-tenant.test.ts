import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  exportFormatsForVariant,
  XIANGQI_MAHJONG_SPEC_ID,
  XMJ_CLAIM_PAUSE_MS,
  type XmjRoomState,
  type XmjSeat,
  type XmjTile,
  xmjOrderedTiles,
  xmjPendingAction,
} from '@mistboard/game';
import { botVsBotConfigFromEnv } from './bot-vs-bot-scheduler.js';
import { gateGameSpecRequest } from './game-spec-request-gate.js';
import { isAllowlistedGameSpec } from './persistence-variant-access.js';
import {
  isXmjBotClientId,
  playXmjBotMove,
  XMJ_BOT_CLIENT_ID,
  xmjBotDelayMs,
  xmjBotMove,
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

// Audit 2026-10-16 finding 6: `handCopy` told the opponent the discarder still
// held a twin of the thrown tile. Serialize the whole event for every recipient.
test('a discard never says whether a twin of the tile is still in hand', () => {
  const event = {
    type: 'move-played',
    at: 2,
    roomId: 'xmj_test',
    color: 'east',
    move: { action: 'discard', tile: 'rC', handCopy: true, by: 'east', at: 2 },
  } as unknown as XmjEvent;
  for (const seat of ['east', 'west', 'spectator'] as const) {
    const wire = JSON.stringify(xmjClientEventFor(event, seat, 3));
    assert.equal(wire.includes('handCopy'), false, seat);
    assert.ok(wire.includes('"tile":"rC"'), seat);
  }
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
    assert.ok(['points', 'draw'].includes(tenant.persistence.termination(state.status.reason)));
  }
});

test('every runtime ending maps to a termination, and an unknown one throws', () => {
  // A match is won on points, never by 'checkmate' (migration 169 added 'points').
  assert.deepEqual(
    ['points', 'tie', 'timeout', 'resignation', 'abandonment'].map((reason) =>
      tenant.persistence.termination(reason),
    ),
    ['points', 'draw', 'timeout', 'resignation', 'abandonment'],
  );
  assert.throws(() => tenant.persistence.termination('exhausted'), /unmapped/);
});

test('the bot seat is an engine seat, so it never reads as a disconnected player', () => {
  assert.equal(isXmjBotClientId(XMJ_BOT_CLIENT_ID), true);
  assert.equal(tenant.engine?.isEngineClientId(XMJ_BOT_CLIENT_ID), true);
  assert.equal(tenant.engine?.isEngineClientId('some-human'), false);
  assert.equal(tenant.oppositeColor('east'), 'west');
});

/** East deals 帥仕俥傌炮 (black 將 here) and discards 俥; west's hand is the variable. */
function botClaimantAfterDiscard(west: XmjTile[]): XmjRoomState {
  const rest = xmjOrderedTiles();
  const east: XmjTile[] = ['bK', 'rA', 'rR', 'bH', 'bC'];
  for (const tile of [...east, ...west, 'rP' as XmjTile]) rest.splice(rest.indexOf(tile), 1);
  const wall = [...east, ...west, 'rP' as XmjTile, ...rest];
  const state = createXmjRoomState({ walls: [wall], firstDealer: 'east' }, 'xmj_bot');
  return applyXmjMove(state, { by: 'east', at: 10_000, action: 'discard', tile: 'rR' });
}

test('a bot claimant settles the window at the same moment, claim or not', () => {
  const canChow = botClaimantAfterDiscard(['rH', 'rC', 'bA', 'rE']);
  const nothing = botClaimantAfterDiscard(['bP', 'bP', 'bA', 'rE']);
  const pauseEnd = 10_000 + XMJ_CLAIM_PAUSE_MS;
  const armedAt = 10_050;
  // The bot waits for the pause like everyone; its timer and the runtime's
  // pass for an empty hand fire together (both run 25 ms past the deadline).
  assert.equal(xmjBotDelayMs(canChow, armedAt), xmjBotDelayMs(nothing, armedAt));
  assert.equal(armedAt + xmjBotDelayMs(nothing, armedAt), pauseEnd + 25);
  // With a claim the bot answers; with none it has nothing to do and the
  // runtime passes. Both moves are the claimant's, dated to the pause end.
  const claim = xmjBotMove(canChow, 'west', pauseEnd + 25);
  assert.equal(claim?.action, 'claim');
  assert.equal(claim?.by, 'west');
  assert.equal(claim?.at, pauseEnd);
  assert.equal(xmjBotMove(nothing, 'west', pauseEnd + 25), null);
  const pass = xmjPendingAction(nothing);
  assert.equal(pass?.at, pauseEnd);
  assert.equal(pass?.move.by, 'west');
  assert.equal(pass?.move.at, pauseEnd);
  // Outside a window the bot keeps its ordinary think time.
  const fresh = createXmjRoomState({ walls: [xmjOrderedTiles()], firstDealer: 'east' });
  assert.equal(xmjBotDelayMs(fresh, 0), 700);
});

// Launch-playbook rule 3: the surfaces Xiangqi Mahjong is left off on purpose.
// No PGN/JSON export (no notation for a tile match), no share card (no board
// position to draw), no TV channel (concealed hands). A finished game opens at
// its own room instead (finishedGameOpensRoom). Bot-vs-bot never schedules it.
test('xiangqi mahjong is off export, share card and TV on purpose', async () => {
  await import('./variant-tenant/register-tenants.js');
  const { registeredVariantTenants } = await import('./variant-tenant/registry.js');
  const entry = registeredVariantTenants().find(
    (candidate) => candidate.gameSpecId === XIANGQI_MAHJONG_SPEC_ID,
  );
  assert.ok(entry, 'xiangqi mahjong is registered');
  assert.deepEqual(exportFormatsForVariant(XIANGQI_MAHJONG_SPEC_ID), []);
  assert.equal(entry.export ?? null, null);
  assert.equal(entry.card ?? null, null);
  assert.equal(entry.watch ?? null, null);
  assert.equal(entry.finishedGameOpensRoom, true);
  const eve = botVsBotConfigFromEnv({
    MISTBOARD_BOT_VS_BOT_VARIANTS: XIANGQI_MAHJONG_SPEC_ID,
  } as NodeJS.ProcessEnv);
  assert.deepEqual(eve.plans, []);
  assert.equal(eve.skipped[0]?.variant, XIANGQI_MAHJONG_SPEC_ID);
});
