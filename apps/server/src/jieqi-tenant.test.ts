/**
 * Jieqi tenant: deal-randomness primitive + hidden-information contract.
 *
 * The deal is a server secret. These pins prove it is minted at creation,
 * persisted in the room-created event for replay, stripped before any client
 * sees the event, and never leaked through the masked view — and that the
 * additive `setup` field leaves setup-free tenants byte-identical.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  JIEQI_SPEC_ID,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { JIEQI_DEFAULT_ENGINE_ID } from './jieqi-engine.js';
import { getJieqiClientView, jieqiClientEventFor, jieqiTenant } from './jieqi-tenant.js';
import { createTenantRuntimeRoom, replayTenantEvents } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

process.env.MISTBOARD_JIEQI_ENABLED = 'true';
process.env.MISTBOARD_DARK_XIANGQI_ENABLED = 'true';

test('jieqi room creation mints and persists a server-secret deal', () => {
  const created = createTenantRuntimeRoom(jieqiTenant, 'jq_deal', { now: 1 });
  if (!created.ok) throw new Error(created.error);

  const event = created.room.events[0];
  if (event.type !== 'room-created') throw new Error('expected room-created first');
  const setup = event.setup as { red: string[]; black: string[] } | undefined;
  assert.ok(setup, 'room-created carries the deal');
  assert.equal(setup.red.length, 15);
  assert.equal(setup.black.length, 15);
});

test('the deal is stripped from room-created before any client sees it', () => {
  const created = createTenantRuntimeRoom(jieqiTenant, 'jq_redact', { now: 1 });
  if (!created.ok) throw new Error(created.error);
  const event = created.room.events[0];
  if (event.type !== 'room-created') throw new Error('expected room-created first');

  for (const seat of ['red', 'black'] as const) {
    const clientEvent = jieqiClientEventFor(event, seat, 0);
    assert.ok(clientEvent, `the seat ${seat} still receives room-created`);
    assert.equal(clientEvent.type, 'room-created');
    assert.ok(!('setup' in clientEvent), `no deal leaks to ${seat}`);
  }
  // /room/ never reveals: spectators receive no events.
  assert.equal(jieqiClientEventFor(event, 'spectator', 0), null);
});

test('replay reconstructs the same deal from the persisted setup', () => {
  const created = createTenantRuntimeRoom(jieqiTenant, 'jq_replay', { now: 1 });
  if (!created.ok) throw new Error(created.error);

  const replayed = replayTenantEvents(jieqiTenant, created.room.events);
  assert.deepEqual(replayed.state.board, created.room.projection.state.board);
  assert.equal(Object.keys(replayed.state.board).length, 32);
});

test('the client view masks every face-down identity', () => {
  const created = createTenantRuntimeRoom(jieqiTenant, 'jq_view', { now: 1 });
  if (!created.ok) throw new Error(created.error);
  const state = created.room.projection.state;

  const view = getJieqiClientView(state, { id: 'c', seat: 'red', solo: false });
  // Only the two generals are face-up at the start; everything else is masked.
  const revealed = Object.values(view.board).filter((entry) => entry && !entry.faceDown);
  assert.equal(revealed.length, 2);
  const a1 = view.board.a1;
  assert.ok(a1 && a1.faceDown === true);
  assert.ok(!('role' in a1), 'a masked entry carries no role');

  const spectator = getJieqiClientView(state, { id: 's', seat: 'spectator', solo: false });
  assert.equal(Object.keys(spectator.board).length, 0);
});

test('a full jieqi game replays through the runtime identically to the kernel', () => {
  const roomId = 'jq_game';
  // A fixed deal makes the scripted line reproducible.
  const events: TenantRoomEvent<'red' | 'black', JieqiMove, typeof JIEQI_SPEC_ID>[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: JIEQI_SPEC_ID, setup: STANDARD_JIEQI_DEAL },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];

  // Drive a deterministic line with the kernel (first legal move each ply),
  // recording the move-played events the runtime will replay.
  let kernelState = createInitialJieqiState(roomId, STANDARD_JIEQI_DEAL);
  let at = 4;
  let plies = 0;
  while (kernelState.status.type === 'playing' && plies < 40) {
    const move = getJieqiLegalMoves(kernelState)[0];
    events.push({ type: 'move-played', at: at++, roomId, color: kernelState.status.turn, move });
    kernelState = applyJieqiMove(kernelState, move);
    plies += 1;
  }
  assert.ok(plies > 0, 'the scripted line made progress');

  // The generic runtime, driven by the tenant, must reach the same canonical
  // state the kernel did — proving the tenant's move path integrates correctly.
  const projection = replayTenantEvents(jieqiTenant, events);
  assert.deepEqual(projection.state, kernelState);
});

test('tenants without createSetup still emit a setup-free room-created', () => {
  const created = createTenantRuntimeRoom(darkXiangqiTenant, 'dxq_x', { now: 1 });
  if (!created.ok) throw new Error(created.error);
  const event = created.room.events[0];
  if (event.type !== 'room-created') throw new Error('expected room-created first');
  assert.ok(!('setup' in event), 'additive setup field does not touch other tenants');
});

// wire.snapshotExtras tells the client a finished game was PvE and which engine
// to rematch — the same fix banqi got. Mirror its guard so jieqi's "Play again"
// can't silently regress back to a PvP invite. snapshotExtras only reads
// room.projection.seats (via tenantPveEngineId) and ignores the client.
function jieqiSnapshotExtrasFor(redClient: string, blackClient: string) {
  const roomId = 'jq_extras';
  const events: TenantRoomEvent<'red' | 'black', JieqiMove, typeof JIEQI_SPEC_ID>[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: JIEQI_SPEC_ID, setup: STANDARD_JIEQI_DEAL },
    { type: 'seat-assigned', at: 2, roomId, clientId: redClient, seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: blackClient, seat: 'black' },
  ];
  const projection = replayTenantEvents(jieqiTenant, events);
  const snapshotExtras = jieqiTenant.wire?.snapshotExtras;
  assert.ok(snapshotExtras, 'jieqi tenant must define wire.snapshotExtras');
  return snapshotExtras({ projection } as never, { seat: 'black' } as never);
}

test('jieqi snapshot marks a PvE room (engine seat) as roomMode:pve with the engine id', () => {
  assert.deepEqual(jieqiSnapshotExtrasFor(JIEQI_DEFAULT_ENGINE_ID, 'human-1'), {
    roomMode: 'pve',
    pveEngineId: JIEQI_DEFAULT_ENGINE_ID,
  });
});

test('jieqi snapshot marks a human-vs-human room as roomMode:pvp (no engine id)', () => {
  assert.deepEqual(jieqiSnapshotExtrasFor('human-1', 'human-2'), { roomMode: 'pvp' });
});

// The valid GameTermination values, kept in sync with the games_termination_check
// CHECK constraint. A termination() output outside this set throws at the DB write,
// silently dropping the finished game. Jieqi's no-capture draw clock spells its reason
// 'no-capture-clock', which is NOT a GameTermination ('progress-clock' is) — the same
// latent bug that lost a no-progress banqi draw, before any jieqi game hit it.
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

test('every jieqi kernel end reason maps to a persistable GameTermination', () => {
  // The full JieqiGameEndReason union. If a reason is added to the kernel, add it here
  // too — termination() must translate each into a value the DB CHECK accepts.
  const jieqiEndReasons = [
    'checkmate',
    'stalemate',
    'no-capture-clock',
    'timeout',
    'resignation',
    'abandonment',
  ];
  for (const reason of jieqiEndReasons) {
    const mapped = jieqiTenant.persistence.termination(reason);
    assert.ok(
      VALID_GAME_TERMINATIONS.has(mapped),
      `jieqi termination(${reason}) -> ${mapped} is not a persistable GameTermination`,
    );
  }
  // The no-capture draw clock specifically — the reason that would be dropped.
  assert.equal(jieqiTenant.persistence.termination('no-capture-clock'), 'progress-clock');
});
