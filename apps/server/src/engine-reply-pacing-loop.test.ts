/**
 * #389: the xiangqi bot loop holds an instant engine move for the reply beat,
 * logs the wait in its decision, and drops the move when the game ends or
 * pauses during the wait.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getStandardXiangqiLegalMoves, type RoomTimeControl } from '@mistboard/game';
import { PACING } from './engine-reply-pacing.js';
import {
  playXiangqiEngineMoveIfReady,
  type XiangqiEngineMoveProvider,
} from './server-xiangqi-engine.js';
import { clearTenantRuntimeTimers } from './variant-tenant/lifecycle.js';
import './variant-tenant/register-tenants.js';
import { appendTenantRuntimeEvent, createTenantRuntimeRoom } from './variant-tenant/runtime.js';
import { XIANGQI_DEFAULT_ENGINE_ID, xiangqiMoveToPikafishUci } from './xiangqi-engine-catalog.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
process.env.MISTBOARD_BOT_PACING = 'true';

const LIVE_TC: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };

// Human red, bot black, red has moved: the bot is on move.
function botOnMove(roomId: string) {
  const start = Date.now() - 5_000;
  const created = createTenantRuntimeRoom(xiangqiTenant, roomId, {
    now: start,
    timeControl: LIVE_TC,
  });
  if (!created.ok) throw new Error(created.error);
  const room = created.room;
  for (const [seat, clientId] of [
    ['red', 'human-client'],
    ['black', XIANGQI_DEFAULT_ENGINE_ID],
  ] as const) {
    appendTenantRuntimeEvent(xiangqiTenant, room, {
      type: 'seat-assigned',
      at: start,
      roomId,
      clientId,
      seat,
    });
  }
  const move = getStandardXiangqiLegalMoves(room.projection.state)[0]!;
  appendTenantRuntimeEvent(xiangqiTenant, room, {
    type: 'move-played',
    at: start + 1_000,
    roomId,
    color: 'red',
    move,
  });
  return Object.assign(room, { clients: new Set() });
}

// A decided position: the reply waits out the beat and no thinking pause.
const decisive =
  (room: ReturnType<typeof botOnMove>): XiangqiEngineMoveProvider =>
  async () => ({
    best: xiangqiMoveToPikafishUci(getStandardXiangqiLegalMoves(room.projection.state)[0]!),
    cp: 2_000,
    mate: null,
    depth: 1,
  });

function writer(appended: string[]) {
  return {
    appendEvent: async (target: unknown, event: { type: string }) => {
      appended.push(event.type);
      return appendTenantRuntimeEvent(xiangqiTenant, target as never, event as never);
    },
    broadcastEventAppended: () => {},
  };
}

test('an instant engine move is held for the beat and the wait is logged', async () => {
  const room = botOnMove('xq_pace_beat');
  const appended: string[] = [];
  const startedAt = Date.now();
  await playXiangqiEngineMoveIfReady(writer(appended) as never, room as never, decisive(room));
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(appended, ['move-played']);
  const floorMs = PACING.beatMs * (1 - PACING.jitter);
  assert.ok(elapsed >= floorMs - 20, `replied after ${elapsed} ms`);
  const decision = room.pendingDebugArtifacts?.at(-1)?.payload as Record<string, unknown>;
  assert.equal(decision.pace_reason, 'decisive');
  assert.ok((decision.pace_target_ms as number) >= floorMs);
  assert.ok((decision.think_time_ms as number) < floorMs, 'compute time excludes the wait');
  clearTenantRuntimeTimers(room as never);
});

test('a game that ends during the wait gets no bot move', async () => {
  const room = botOnMove('xq_pace_resign');
  const appended: string[] = [];
  setTimeout(() => {
    appendTenantRuntimeEvent(xiangqiTenant, room, {
      type: 'seat-resigned',
      at: Date.now(),
      roomId: room.id,
      color: 'red',
    });
  }, 100);
  await playXiangqiEngineMoveIfReady(writer(appended) as never, room as never, decisive(room));

  assert.deepEqual(appended, [], 'the held move never reached the writer');
  assert.equal(room.projection.state.status.type, 'finished');
  clearTenantRuntimeTimers(room as never);
});
