/** Whole serialized payloads must be invariant under swapping still-covered
 * identities. Unlike Three Kingdoms, this includes the finished snapshot.
 * Planting its truthView in the FFQ tenant must fail this regression.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFFQBanqiMove,
  type BanqiColor,
  type BanqiDeal,
  createFFQBanqiDeal,
  createFFQBanqiStateFromSetup,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  ffqBanqiStateToFen,
  getFFQBanqiLegalMoves,
} from '@mistboard/game';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { gateGameSpecRequest } from './game-spec-request-gate.js';
import './variant-tenant/register-tenants.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';
import {
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

const ROOM = 'ffq_hidden';
const VIEWERS = ['red', 'black', 'spectator'] as const;

function log(deal: BanqiDeal, moves: readonly FFQBanqiMove[]): FFQBanqiEvent[] {
  return [
    { type: 'room-created', at: 1, roomId: ROOM, gameSpecId: FFQ_BANQI_SPEC_ID, setup: { deal } },
    { type: 'seat-assigned', at: 2, roomId: ROOM, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM, clientId: 'b', seat: 'black' },
    ...moves.map(
      (move, ply): FFQBanqiEvent => ({
        type: 'move-played',
        at: ply + 10,
        roomId: ROOM,
        color: ply % 2 === 0 ? 'red' : 'black',
        move,
      }),
    ),
  ];
}

function payload(events: readonly FFQBanqiEvent[], seat: BanqiColor | 'spectator') {
  const hydrated = createTenantRuntimeRoomFromEvents(ffqBanqiTenant, events);
  assert.ok(hydrated.ok);
  const room = hydrated.room;
  const client = { id: `c-${seat}`, seat, solo: false };
  const { serverAt: _time, ...snapshot } = tenantSnapshotPayload(ffqBanqiTenant, room, client);
  const serialized = JSON.stringify({
    snapshot,
    events: tenantEventsForClient(ffqBanqiTenant, room, client),
    ...tenantLiveHistoryExtras(ffqBanqiTenant, room, client),
    fen: ffqBanqiStateToFen(room.projection.state),
  });
  // Inspect the actual JSON tree, including additions anywhere in the envelope.
  JSON.parse(serialized, (key, value) => {
    assert.ok(!['setup', 'deal', 'seed'].includes(key), `${seat} payload carries canonical ${key}`);
    if (value && typeof value === 'object' && value.faceDown === true) {
      assert.deepEqual(value, { faceDown: true }, `${seat} payload carries a covered identity`);
    }
    return value;
  });
  return serialized;
}

// The same seed as the websocket HP line: captures, covered victims, flips,
// quiet moves and an HP ending while several on-board identities remain hidden.
const dealA = createFFQBanqiDeal(800);
let state = createFFQBanqiStateFromSetup(ROOM, { deal: dealA });
const moves: FFQBanqiMove[] = [];
while (state.status.type === 'playing' && moves.length < 100) {
  const legal = getFFQBanqiLegalMoves(state);
  const move =
    legal.find((m) => m.from !== m.to && state.board[m.to]) ??
    legal.find((m) => m.from === m.to) ??
    legal[0];
  assert.ok(move);
  moves.push(move);
  state = applyFFQBanqiMove(state, move);
}
const i = state.board.findIndex((piece) => piece?.faceDown);
const j = state.board.findIndex(
  (piece, square) =>
    piece?.faceDown &&
    square !== i &&
    (piece.color !== state.board[i]!.color || piece.role !== state.board[i]!.role),
);
assert.ok(i >= 0 && j >= 0, 'two different covered identities remain');
const dealB = [...dealA];
[dealB[i], dealB[j]] = [dealB[j], dealB[i]];
const eventsA = log(dealA, moves);
const eventsB = log(dealB, moves);

test('FFQ privacy fixture reaches HP with public covered captures and distinct secret setups', () => {
  assert.deepEqual(state.status, { type: 'finished', winner: 'red', reason: 'hp' });
  assert.ok(state.captures.some((capture) => capture.wasFaceDown));
  assert.notDeepEqual(eventsA[0], eventsB[0]);
  assert.notDeepEqual(
    replayTenantEvents(ffqBanqiTenant, eventsA).state.board,
    replayTenantEvents(ffqBanqiTenant, eventsB).state.board,
    'the planted secret difference really exists',
  );
  assert.deepEqual(replayTenantEvents(ffqBanqiTenant, eventsB).state.status, state.status);
});

test('serialized FFQ seat and observer payloads mask identities at every ply, live AND HP-finished', () => {
  for (let ply = 0; ply <= moves.length; ply++) {
    for (const viewer of VIEWERS) {
      const a = payload(eventsA.slice(0, 3 + ply), viewer);
      const b = payload(eventsB.slice(0, 3 + ply), viewer);
      assert.equal(a, b, `${viewer} payload after ${ply} plies leaks a covered identity`);
      const wire = JSON.parse(a);
      assert.equal(wire.liveHistory.length, ply + 1);
      assert.deepEqual(
        wire.snapshot.state.captured,
        replayTenantEvents(ffqBanqiTenant, eventsA.slice(0, 3 + ply)).state.captures,
        'off-board captures are public to both seats and observers',
      );
      if (viewer === 'spectator') {
        assert.equal(wire.snapshot.state.perspective, 'observer');
        assert.deepEqual(wire.snapshot.state.legalMoves, []);
        for (const entry of wire.liveHistory) assert.deepEqual(entry.view.legalMoves, []);
      }
    }
  }
});

test('resignation, abandonment, agreed draw and aborted FFQ rooms retain the mask and never ship setup', () => {
  const endings: FFQBanqiEvent[][] = [
    [{ type: 'seat-resigned', at: 100, roomId: ROOM, color: 'red' }],
    [{ type: 'seat-forfeited', at: 100, roomId: ROOM, color: 'black' }],
    [
      { type: 'draw-offered', at: 100, roomId: ROOM, color: 'red' },
      { type: 'draw-agreed', at: 101, roomId: ROOM, color: 'black' },
    ],
    [{ type: 'game-aborted', at: 100, roomId: ROOM, reason: 'user-abort' }],
  ];
  for (const ending of endings) {
    // Both players have moved and many tiles remain covered. Abort must be
    // earlier, inside the pregame abort window.
    const count = ending[0].type === 'game-aborted' ? 3 : 5;
    const a = [...eventsA.slice(0, count), ...ending];
    const b = [...eventsB.slice(0, count), ...ending];
    assert.notEqual(replayTenantEvents(ffqBanqiTenant, a).state.status.type, 'playing');
    for (const viewer of VIEWERS)
      assert.equal(payload(a, viewer), payload(b, viewer), ending[0].type);
  }
});

test('loading the FFQ tenant leaves every network path unregistered and request selectors rejected', () => {
  assert.equal(
    registeredVariantTenants().some(
      (entry) =>
        entry.gameSpecId === FFQ_BANQI_SPEC_ID ||
        entry.roomIdPrefix === ffqBanqiTenant.roomIdPrefix,
    ),
    false,
  );
  for (const input of [{ gameSpecId: FFQ_BANQI_SPEC_ID }, { variant: FFQ_BANQI_SPEC_ID }]) {
    assert.deepEqual(gateGameSpecRequest(input), {
      type: 'reject',
      error: 'ffq_banqi_disabled',
      httpStatus: 404,
      wsCloseReason: 'game spec disabled',
    });
  }
  assert.equal(ffqBanqiTenant.visibility.truthView, undefined, 'FFQ has no finished-board reveal');
});
