/**
 * #389: the xiangqi bot loop holds an instant engine move for the reply beat,
 * logs the wait in its decision, and drops the move when the game ends or
 * pauses during the wait.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getJieqiLegalMoves,
  getStandardXiangqiLegalMoves,
  type RoomTimeControl,
} from '@mistboard/game';
import { PACING } from './engine-reply-pacing.js';
import { jieqiMoveToPikafishUci } from './jieqi-fen.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { playJieqiEngineMoveIfReady } from './server-jieqi-engine.js';
import {
  playXiangqiEngineMoveIfReady,
  type XiangqiEngineMoveProvider,
} from './server-xiangqi-engine.js';
import { clearTenantRuntimeTimers } from './variant-tenant/lifecycle.js';
import './variant-tenant/register-tenants.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  tenantPauseEventFor,
  tenantResumeEventFor,
} from './variant-tenant/runtime.js';
import { XIANGQI_DEFAULT_ENGINE_ID, xiangqiMoveToPikafishUci } from './xiangqi-engine-catalog.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
process.env.MISTBOARD_BOT_PACING = 'true';
process.env.MISTBOARD_BOT_PACING_VARIANTS = 'xiangqi,jieqi';
process.env.MISTBOARD_JIEQI_ENABLED = 'true';

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

// The reply wait's timer is unref'd so it never holds a stopping server open.
// Here it is the only pending work, and Node 22 cancels a test whose event
// loop empties while it awaits, so hold the loop open for the test.
function holdEventLoop(): () => void {
  const timer = setInterval(() => {}, 1_000);
  return () => clearInterval(timer);
}

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
  const release = holdEventLoop();
  const startedAt = Date.now();
  try {
    await playXiangqiEngineMoveIfReady(writer(appended) as never, room as never, decisive(room));
  } finally {
    release();
  }
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
  const release = holdEventLoop();
  try {
    await playXiangqiEngineMoveIfReady(writer(appended) as never, room as never, decisive(room));
  } finally {
    release();
  }

  assert.deepEqual(appended, [], 'the held move never reached the writer');
  assert.equal(room.projection.state.status.type, 'finished');
  clearTenantRuntimeTimers(room as never);
});

test('room cleanup cancels a held reply without changing the board', async () => {
  const room = botOnMove('xq_pace_closed');
  const appended: string[] = [];
  const release = holdEventLoop();
  const timer = setTimeout(() => clearTenantRuntimeTimers(room as never), 100);
  try {
    await playXiangqiEngineMoveIfReady(writer(appended) as never, room as never, decisive(room));
    assert.deepEqual(appended, [], 'a closed room must never receive the held move');
  } finally {
    clearTimeout(timer);
    release();
    clearTenantRuntimeTimers(room as never);
  }
});

function jieqiBotOnMove(roomId: string) {
  const start = Date.now() - 5_000;
  const created = createTenantRuntimeRoom(jieqiTenant, roomId, {
    now: start,
    timeControl: LIVE_TC,
  });
  assert.ok(created.ok);
  const room = created.room;
  for (const [seat, clientId] of [
    ['red', 'human-client'],
    ['black', 'pikafish-jieqi-strongest'],
  ] as const) {
    appendTenantRuntimeEvent(jieqiTenant, room, {
      type: 'seat-assigned',
      at: start,
      roomId,
      clientId,
      seat,
    });
  }
  appendTenantRuntimeEvent(jieqiTenant, room, {
    type: 'move-played',
    at: start + 1_000,
    roomId,
    color: 'red',
    move: getJieqiLegalMoves(room.projection.state)[0]!,
  });
  return Object.assign(room, { clients: new Set() });
}

for (const variant of ['xiangqi', 'jieqi'] as const) {
  for (const interruption of [
    'resign',
    'abort',
    'takeback',
    'flag',
    'elapsed-clock',
    'pause',
    'pause-resume',
    'close',
    'close-during-search',
    'shutdown',
  ] as const) {
    test(`${variant}: ${interruption} cancels a held reply promptly`, async () => {
      const room =
        variant === 'xiangqi'
          ? botOnMove(`xq_${interruption}`)
          : jieqiBotOnMove(`jqe_${interruption}`);
      const tenant = variant === 'xiangqi' ? xiangqiTenant : jieqiTenant;
      const append = (event: unknown) =>
        appendTenantRuntimeEvent(tenant as never, room as never, event as never);
      const appended: string[] = [];
      const ctx = {
        appendEvent: async (_room: unknown, event: { type: string }) => {
          appended.push(event.type);
          return append(event);
        },
        broadcastEventAppended: () => {},
      };
      const provider = async () => {
        if (interruption === 'close-during-search') {
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        return {
          best:
            variant === 'xiangqi'
              ? xiangqiMoveToPikafishUci(
                  getStandardXiangqiLegalMoves(room.projection.state as never)[0]!,
                )
              : jieqiMoveToPikafishUci(getJieqiLegalMoves(room.projection.state as never)[0]!),
          cp: 2_000,
          mate: null,
          depth: 1,
        };
      };
      const release = holdEventLoop();
      const started = Date.now();
      const timer = setTimeout(() => {
        const at = Date.now();
        const common = { at, roomId: room.id };
        switch (interruption) {
          case 'resign':
            append({ ...common, type: 'seat-resigned', color: 'red' });
            break;
          case 'abort':
            append({ ...common, type: 'game-aborted', reason: 'user-abort' });
            break;
          // There is no live tenant takeback endpoint. Replacing the projection models
          // a restored position with the same side on move (the dangerous case).
          case 'takeback':
            room.projection.state = { ...room.projection.state };
            break;
          case 'flag':
            append({
              ...common,
              type: 'clock-expired',
              color: 'black',
              clock: {
                ...room.projection.clock!,
                remainingMs: { red: 180_000, black: 0 },
                runningSince: null,
              },
            });
            break;
          case 'elapsed-clock':
            // The flag timer may still be queued when a search or hold resolves.
            room.projection.clock!.activeColor = 'black';
            room.projection.clock!.runningSince =
              Date.now() - room.projection.clock!.remainingMs.black - 1;
            break;
          case 'pause':
          case 'pause-resume': {
            const pause = tenantPauseEventFor(room.projection as never, at, 'shutdown');
            assert.ok(pause);
            append(pause);
            if (interruption === 'pause-resume')
              append(tenantResumeEventFor(room.projection as never, at + 1, 'players-returned'));
            break;
          }
          case 'close':
          case 'close-during-search':
            clearTenantRuntimeTimers(room as never);
            break;
          case 'shutdown':
            Object.assign(room, { stopping: true });
            break;
        }
      }, 60);
      try {
        const play =
          variant === 'xiangqi' ? playXiangqiEngineMoveIfReady : playJieqiEngineMoveIfReady;
        await play(ctx as never, room as never, provider);
        assert.deepEqual(appended, []);
        assert.ok(Date.now() - started < 400, 'cancellation should not wait out the reply beat');
        assert.equal(
          room.pendingDebugArtifacts?.length ?? 0,
          0,
          'cancelled replies create no decision artifact',
        );
      } finally {
        clearTimeout(timer);
        release();
        clearTenantRuntimeTimers(room as never);
      }
    });
  }
}
