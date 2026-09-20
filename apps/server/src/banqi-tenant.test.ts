/**
 * Banqi tenant: deal-randomness primitive + hidden-information contract.
 *
 * The deal is a server secret. These pins prove it is minted at creation,
 * persisted in the room-created event for replay, stripped before any client
 * sees the event, and never leaked through the masked view — and that the
 * generic runtime, driven by the tenant, reaches the same state the kernel does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyBanqiMove,
  BANQI_SPEC_ID,
  type BanqiDeal,
  type BanqiMove,
  type BanqiSeat,
  createBanqiDeal,
  createInitialBanqiState,
  getBanqiLegalMoves,
} from '@mistboard/game';
import { BANQI_DEFAULT_ENGINE_ID } from './banqi-engine.js';
import { banqiClientEventFor, banqiTenant, getBanqiClientView } from './banqi-tenant.js';
import { createTenantRuntimeRoom, replayTenantEvents } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

process.env.MISTBOARD_BANQI_ENABLED = 'true';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('banqi room creation mints and persists a server-secret deal', () => {
  const created = createTenantRuntimeRoom(banqiTenant, 'bq_deal', { now: 1 });
  if (!created.ok) throw new Error(created.error);

  const event = created.room.events[0];
  if (event.type !== 'room-created') throw new Error('expected room-created first');
  const setup = event.setup as BanqiDeal | undefined;
  assert.ok(setup, 'room-created carries the deal');
  assert.equal(setup.length, 32);
  assert.equal(setup.filter((p) => p.color === 'red').length, 16);
  assert.equal(setup.filter((p) => p.color === 'black').length, 16);
});

test('the deal is stripped from room-created before any client sees it', () => {
  const created = createTenantRuntimeRoom(banqiTenant, 'bq_redact', { now: 1 });
  if (!created.ok) throw new Error(created.error);
  const event = created.room.events[0];
  if (event.type !== 'room-created') throw new Error('expected room-created first');

  for (const seat of ['red', 'black'] as const) {
    const clientEvent = banqiClientEventFor(event, seat, 0);
    assert.ok(clientEvent, `the seat ${seat} still receives room-created`);
    assert.equal(clientEvent.type, 'room-created');
    assert.ok(!('setup' in clientEvent), `no deal leaks to ${seat}`);
  }
  // The position is public: a spectator receives the same stripped event.
  const spectatorEvent = banqiClientEventFor(event, 'spectator', 0);
  assert.ok(spectatorEvent && !('setup' in spectatorEvent), 'no deal leaks to a spectator');
});

test('replay reconstructs the same board from the persisted setup', () => {
  const created = createTenantRuntimeRoom(banqiTenant, 'bq_replay', { now: 1 });
  if (!created.ok) throw new Error(created.error);

  const replayed = replayTenantEvents(banqiTenant, created.room.events);
  assert.deepEqual(replayed.state.board, created.room.projection.state.board);
  assert.equal(Object.keys(replayed.state.board).length, 32);
});

test('the client view masks every face-down identity (all 32 at the start)', () => {
  const created = createTenantRuntimeRoom(banqiTenant, 'bq_view', { now: 1 });
  if (!created.ok) throw new Error(created.error);
  const state = created.room.projection.state;

  const view = getBanqiClientView(state, { id: 'c', seat: 'red', solo: false });
  const revealed = Object.values(view.board).filter((entry) => entry && !entry.faceDown);
  assert.equal(revealed.length, 0); // banqi starts fully face-down
  const a1 = view.board.a1;
  assert.ok(a1 && a1.faceDown === true);
  assert.ok(!('role' in a1), 'a masked entry carries no role');
  assert.ok(!('color' in a1), 'a masked entry carries no ink');

  // A spectator gets the same masked board (banqi is symmetric) and nothing to play.
  const spectator = getBanqiClientView(state, { id: 's', seat: 'spectator', solo: false });
  assert.deepEqual(spectator.board, view.board);
  assert.deepEqual(spectator.legalMoves, []);
});

test('a full banqi game replays through the runtime identically to the kernel', () => {
  const roomId = 'bq_game';
  const deal = createBanqiDeal(seeded(7)); // a fixed deal makes the line reproducible
  const events: TenantRoomEvent<BanqiSeat, BanqiMove, typeof BANQI_SPEC_ID>[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: BANQI_SPEC_ID, setup: deal },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'a', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];

  // Drive a deterministic line with the kernel (first legal move each ply),
  // recording the move-played events keyed by the SEAT to move.
  let kernelState = createInitialBanqiState(roomId, deal);
  let at = 4;
  let plies = 0;
  while (kernelState.status.type === 'playing' && plies < 60) {
    const move = getBanqiLegalMoves(kernelState)[0];
    events.push({ type: 'move-played', at: at++, roomId, color: kernelState.status.turn, move });
    kernelState = applyBanqiMove(kernelState, move);
    plies += 1;
  }
  assert.ok(plies > 0, 'the scripted line made progress');
  // The first action is always a flip (pre-binding, only flips are legal).
  const firstMove = events.find((e) => e.type === 'move-played');
  assert.ok(
    firstMove && firstMove.type === 'move-played' && firstMove.move.from === firstMove.move.to,
  );

  // The generic runtime, driven by the tenant, must reach the same canonical
  // state the kernel did — proving the tenant's move path integrates correctly.
  const projection = replayTenantEvents(banqiTenant, events);
  assert.deepEqual(projection.state, kernelState);
});

// wire.snapshotExtras is what tells the client a finished game was PvE and which
// engine to rematch. Build a real seat map via replayTenantEvents, then read the
// extras a client would receive. snapshotExtras only reads room.projection.seats
// (via tenantPveEngineId) and ignores the client, so a minimal room wrapping the
// real projection is the faithful fixture.
function banqiSnapshotExtrasFor(redClient: string, blackClient: string) {
  const roomId = 'bq_extras';
  const deal = createBanqiDeal(seeded(7));
  const events: TenantRoomEvent<BanqiSeat, BanqiMove, typeof BANQI_SPEC_ID>[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: BANQI_SPEC_ID, setup: deal },
    { type: 'seat-assigned', at: 2, roomId, clientId: redClient, seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: blackClient, seat: 'black' },
  ];
  const projection = replayTenantEvents(banqiTenant, events);
  const snapshotExtras = banqiTenant.wire?.snapshotExtras;
  assert.ok(snapshotExtras, 'banqi tenant must define wire.snapshotExtras');
  return snapshotExtras({ projection } as never, { seat: 'black' } as never);
}

test('banqi snapshot marks a PvE room (engine seat) as roomMode:pve with the engine id', () => {
  // Regression guard for the "Play again made a PvP invite" bug: the client can
  // only re-create a PvE game vs the same engine if the snapshot says the room
  // is PvE and which engine holds a seat.
  assert.deepEqual(banqiSnapshotExtrasFor(BANQI_DEFAULT_ENGINE_ID, 'human-1'), {
    roomMode: 'pve',
    pveEngineId: BANQI_DEFAULT_ENGINE_ID,
  });
});

test('banqi snapshot marks a human-vs-human room as roomMode:pvp (no engine id)', () => {
  assert.deepEqual(banqiSnapshotExtrasFor('human-1', 'human-2'), { roomMode: 'pvp' });
});

// The valid GameTermination values, kept in sync with the games_termination_check
// CHECK constraint. A termination() output outside this set throws at the DB write
// (a constraint violation), silently dropping the finished game — exactly the bug
// that lost the first no-progress banqi draw, whose kernel reason 'no-progress' is
// NOT a GameTermination ('progress-clock' is).
const VALID_GAME_TERMINATIONS = new Set([
  'king-captured',
  'general-captured',
  'timeout',
  'checkmate',
  'draw',
  'resignation',
  'engine-failure',
  'worker-aborted',
  'server-restarted',
  'abandoned',
  'abandonment',
  'no-legal-moves',
  'stalemate',
  'repetition',
  'progress-clock',
  'truncated',
  'race',
]);

test('every banqi kernel end reason maps to a persistable GameTermination', () => {
  // The full BanqiGameEndReason union. If a reason is added to the kernel, add it
  // here too — the point is that termination() must translate each into a value the
  // DB CHECK accepts, never blind-cast an unknown string through.
  const banqiEndReasons = [
    'stalemate',
    'no-progress',
    'repetition',
    'timeout',
    'resignation',
    'abandonment',
  ];
  for (const reason of banqiEndReasons) {
    const mapped = banqiTenant.persistence.termination(reason);
    assert.ok(
      VALID_GAME_TERMINATIONS.has(mapped),
      `banqi termination(${reason}) -> ${mapped} is not a persistable GameTermination`,
    );
  }
  // The no-progress draw specifically — the reason that was being dropped.
  assert.equal(banqiTenant.persistence.termination('no-progress'), 'progress-clock');
});
