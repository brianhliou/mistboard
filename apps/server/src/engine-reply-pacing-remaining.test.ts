import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  crazyhouseXiangqiMoveToUci,
  getCrazyhouseXiangqiLegalMoves,
  getDuckXiangqiLegalTurns,
  getGomokuLegalMoves,
  getThreeKingdomsBanqiLegalMoves,
} from '@mistboard/game';
import { crazyhouseXiangqiTenant } from './crazyhouse-xiangqi-tenant.js';
import { duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import { playGomokuEngineMoveIfReady } from './gomoku-engine.js';
import { gomokuTenant } from './gomoku-tenant.js';
import { playCrazyhouseXiangqiEngineMoveIfReady } from './server-crazyhouse-xiangqi-engine.js';
import {
  duckXiangqiTurnToFsfUci,
  playDuckXiangqiEngineMoveIfReady,
} from './server-duck-xiangqi-engine.js';
import {
  playThreeKingdomsBanqiEngineMoveIfReady,
  threeKingdomsBanqiMoveToUci,
} from './server-three-kingdoms-banqi-engine.js';
import { threeKingdomsBanqiTenant } from './three-kingdoms-banqi-tenant.js';
import { clearTenantRuntimeTimers } from './variant-tenant/lifecycle.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  tenantPauseEventFor,
  tenantResumeEventFor,
} from './variant-tenant/runtime.js';

const CASES = ['duck-xiangqi', 'crazyhouse-xiangqi', 'three-kingdoms-banqi', 'gomoku'] as const;
type Variant = (typeof CASES)[number];
function env(t: TestContext, key: string, value: string) {
  const old = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  });
}
function fixture(t: TestContext, variant: Variant) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  env(t, 'MISTBOARD_BOT_PACING', 'true');
  env(t, 'MISTBOARD_DUCK_XIANGQI_ENABLED', 'true');
  env(t, 'MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED', 'true');
  env(t, 'MISTBOARD_BOT_PACING_VARIANTS', CASES.join(','));
  const tenant =
    variant === 'duck-xiangqi'
      ? duckXiangqiTenant
      : variant === 'crazyhouse-xiangqi'
        ? crazyhouseXiangqiTenant
        : variant === 'gomoku'
          ? gomokuTenant
          : threeKingdomsBanqiTenant;
  const fixtureTenant =
    variant === 'gomoku'
      ? {
          ...gomokuTenant,
          rules: {
            ...gomokuTenant.rules,
            createSetup: () => ({ stones: [], turn: 'black' as const }),
          },
        }
      : tenant;
  const engineId =
    variant === 'duck-xiangqi'
      ? 'fairy-stockfish-duck-xiangqi-level-1'
      : variant === 'crazyhouse-xiangqi'
        ? 'fairy-stockfish-crazyhouse-xiangqi-level-1'
        : variant === 'gomoku'
          ? 'rapfi-level-1'
          : 'misty-three-kingdoms-banqi-level-2';
  const seat = variant === 'gomoku' ? 'black' : 'red';
  const human = variant === 'gomoku' ? 'white' : 'black';
  // The same runtime protocol, with variant-specific state kept opaque at the boundary.
  const created = createTenantRuntimeRoom(
    fixtureTenant as typeof duckXiangqiTenant,
    `pace_${variant}`,
    { now: Date.now(), timeControl: { initialMs: 60_000, incrementMs: 1_000 } },
  );
  assert.ok(created.ok);
  const room = created.room;
  const append = (event: unknown) =>
    appendTenantRuntimeEvent(tenant as never, room as never, event as never);
  for (const [color, clientId] of [
    [seat, engineId],
    [human, 'human'],
  ])
    append({ type: 'seat-assigned', roomId: room.id, at: Date.now(), seat: color, clientId });
  room.projection.clock!.activeColor = seat as never;
  room.projection.clock!.runningSince = Date.now();
  const appended: string[] = [];
  const ctx = {
    appendEvent: async (_room: unknown, event: { type: string }) => {
      assert.ok(
        room.pendingDebugArtifacts?.length,
        'queue the decision before a terminal append can flush it',
      );
      appended.push(event.type);
      return append(event);
    },
    broadcastEventAppended: () => {},
  };
  const legal = () =>
    variant === 'duck-xiangqi'
      ? getDuckXiangqiLegalTurns(room.projection.state)
      : variant === 'crazyhouse-xiangqi'
        ? getCrazyhouseXiangqiLegalMoves(room.projection.state as never)
        : variant === 'gomoku'
          ? getGomokuLegalMoves(room.projection.state as never)
          : getThreeKingdomsBanqiLegalMoves(room.projection.state as never);
  const uci = () =>
    variant === 'duck-xiangqi'
      ? duckXiangqiTurnToFsfUci(legal()[0] as never)
      : variant === 'crazyhouse-xiangqi'
        ? crazyhouseXiangqiMoveToUci(legal()[0] as never)
        : variant === 'gomoku'
          ? (legal()[0] as { to: string }).to
          : threeKingdomsBanqiMoveToUci(legal()[0] as never);
  const caps: number[] = [];
  let hook: () => string | null | undefined = () => undefined;
  const result = () => {
    const best = hook();
    return { best: best === undefined ? uci() : best, cp: 0, mate: null, depth: 1 };
  };
  const play = () =>
    variant === 'duck-xiangqi'
      ? playDuckXiangqiEngineMoveIfReady(ctx as never, room as never, async (_id, _moves, opts) => {
          caps.push(opts.movetimeMs!);
          return result();
        })
      : variant === 'crazyhouse-xiangqi'
        ? playCrazyhouseXiangqiEngineMoveIfReady(
            ctx as never,
            room as never,
            async (_id, _moves, opts) => {
              caps.push(opts.movetimeMs!);
              return result();
            },
          )
        : variant === 'gomoku'
          ? playGomokuEngineMoveIfReady(ctx as never, room as never, async (_state, _id, opts) => {
              caps.push((opts as { movetimeMs?: number }).movetimeMs!);
              const r = result();
              return r.best ? { to: r.best as never } : null;
            })
          : playThreeKingdomsBanqiEngineMoveIfReady(
              ctx as never,
              room as never,
              async (request) => {
                caps.push(request.movetimeCapMs);
                return result();
              },
            );
  t.after(() => clearTenantRuntimeTimers(room as never));
  return {
    room,
    append,
    appended,
    play,
    caps,
    seat,
    human,
    hook: (next: typeof hook) => {
      hook = next;
    },
  };
}
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

for (const variant of CASES) {
  test(`${variant}: holds a fast reply and queues pacing before append`, async (t) => {
    const f = fixture(t, variant);
    const pending = f.play();
    await flush();
    assert.deepEqual(f.appended, [], 'fast search must wait');
    t.mock.timers.tick(12_000);
    await pending;
    assert.deepEqual(f.appended, ['move-played']);
    const payload = f.room.pendingDebugArtifacts?.[0]?.payload;
    assert.ok(payload);
    assert.equal(payload.pace_reason, 'paced');
    assert.ok(Number(payload.pace_wait_ms) >= 700);
    assert.equal(payload.think_time_ms, 0);
  });
  for (const interruption of [
    'close',
    'shutdown',
    'restore',
    'pause-resume',
    'elapsed-clock',
    'seat-change',
    'resign',
    'pending-write',
    'at-deadline',
  ] as const) {
    test(`${variant}: ${interruption} discards reply and artifact`, async (t) => {
      const f = fixture(t, variant);
      const pending = f.play();
      await flush();
      if (interruption === 'at-deadline') {
        t.mock.timers.tick(12_000);
        Object.assign(f.room, { stopping: true });
      }
      if (interruption === 'close') clearTenantRuntimeTimers(f.room as never);
      if (interruption === 'shutdown') Object.assign(f.room, { stopping: true });
      if (interruption === 'restore') {
        if (variant === 'gomoku') {
          const state = f.room.projection.state as unknown as { board: unknown[] };
          const board = [...state.board];
          board[0] = 'white';
          f.room.projection.state = { ...f.room.projection.state, board } as never;
        } else f.room.projection.state = { ...f.room.projection.state };
      }
      if (interruption === 'seat-change')
        Object.assign(f.room.projection.seats, { [f.seat]: 'human' });
      if (interruption === 'elapsed-clock')
        f.room.projection.clock!.runningSince = Date.now() - 60_001;
      if (interruption === 'resign')
        f.append({ type: 'seat-resigned', roomId: f.room.id, at: Date.now(), color: f.human });
      if (interruption === 'pause-resume') {
        f.append(tenantPauseEventFor(f.room.projection as never, Date.now(), 'shutdown'));
        f.append(tenantResumeEventFor(f.room.projection as never, Date.now(), 'players-returned'));
      }
      if (interruption === 'pending-write')
        f.room.pendingWrites = Promise.resolve().then(() => {
          Object.assign(f.room, { stopping: true });
        });
      t.mock.timers.tick(12_000);
      await pending;
      assert.deepEqual(f.appended, []);
      assert.equal(f.room.pendingDebugArtifacts?.length ?? 0, 0);
      if (interruption === 'close')
        assert.equal(f.room.engineTimer, null, 'cleanup must not restart the disposed room');
    });
  }
  for (const exclusion of [
    'master-off',
    'variant-off',
    'eve',
    'correspondence',
    'low-clock',
  ] as const) {
    test(`${variant}: ${exclusion} skips the hold and records its reason`, async (t) => {
      const f = fixture(t, variant);
      if (exclusion === 'master-off') env(t, 'MISTBOARD_BOT_PACING', 'false');
      if (exclusion === 'variant-off') env(t, 'MISTBOARD_BOT_PACING_VARIANTS', 'banqi');
      if (exclusion === 'eve')
        Object.assign(f.room.projection.seats, {
          [f.human]: f.room.projection.seats[f.seat as 'red'],
        });
      if (exclusion === 'correspondence')
        f.room.projection.timeControl = { initialMs: 86_400_000, incrementMs: 0, daysPerMove: 1 };
      if (exclusion === 'low-clock')
        Object.assign(f.room.projection.clock!.remainingMs, { [f.seat]: 9_000 });
      await f.play();
      assert.deepEqual(f.appended, ['move-played']);
      assert.equal(
        f.room.pendingDebugArtifacts?.[0]?.payload.pace_reason,
        exclusion === 'eve'
          ? 'engine-vs-engine'
          : exclusion === 'correspondence'
            ? 'correspondence'
            : exclusion === 'low-clock'
              ? 'low-clock'
              : 'off',
      );
    });
  }
  test(`${variant}: retry does not spend the starting-clock reserve`, async (t) => {
    const f = fixture(t, variant);
    Object.assign(f.room.projection.clock!.remainingMs, { [f.seat]: 6_100 });
    f.hook(() => {
      assert.ok(f.caps.at(-1)! <= 100);
      t.mock.timers.tick(100);
      return null;
    });
    await f.play();
    assert.equal(f.caps.length, 1);
    assert.deepEqual(f.appended, []);
  });
  test(`${variant}: cleanup during search cancels success and failure`, async (t) => {
    const f = fixture(t, variant);
    f.hook(() => {
      clearTenantRuntimeTimers(f.room as never);
      return null;
    });
    await f.play();
    assert.deepEqual(f.appended, []);
    assert.equal(f.room.pendingDebugArtifacts?.length ?? 0, 0);
    assert.equal(f.room.engineTimer, null, 'cleanup during search must not restart the room');
  });
  test(`${variant}: infrastructure failure does not wait`, async (t) => {
    const f = fixture(t, variant);
    f.hook(() => null);
    await f.play();
    assert.deepEqual(f.appended, [variant === 'gomoku' ? 'seat-forfeited' : 'seat-resigned']);
    assert.equal(f.room.pendingDebugArtifacts?.[0]?.payload.pace_wait_ms, 0);
  });
  test(`${variant}: follows writes added while draining the old tail`, async (t) => {
    const f = fixture(t, variant);
    let release!: () => void;
    f.room.pendingWrites = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = f.play();
    await flush();
    f.room.pendingWrites = f.room.pendingWrites.then(() => {
      f.append({ type: 'seat-resigned', roomId: f.room.id, at: Date.now(), color: f.human });
    });
    release();
    await flush();
    t.mock.timers.tick(12_000);
    await pending;
    assert.deepEqual(f.appended, []);
    assert.equal(f.room.pendingDebugArtifacts?.length ?? 0, 0);
  });
}

test('Three Kingdoms: the process-free random tier uses the same pacing and artifact', async (t) => {
  const f = fixture(t, 'three-kingdoms-banqi');
  f.room.projection.seats.red = 'misty-three-kingdoms-banqi-level-1';
  const pending = f.play();
  await flush();
  assert.deepEqual(f.appended, []);
  t.mock.timers.tick(12_000);
  await pending;
  assert.equal(f.caps.length, 0);
  assert.equal(f.room.pendingDebugArtifacts?.[0]?.payload.pace_reason, 'paced');
  assert.equal(f.room.pendingDebugArtifacts?.[0]?.payload.movetime_ms, null);
});

test('Duck: a direct general capture gets the short beat and a terminal decision', async (t) => {
  const f = fixture(t, 'duck-xiangqi');
  f.room.projection.state = {
    ...f.room.projection.state,
    board: {
      e1: { color: 'red', role: 'general' },
      e5: { color: 'red', role: 'chariot' },
      e10: { color: 'black', role: 'general' },
    },
    duck: 'a1',
  };
  f.hook(() => {
    assert.fail('a direct capture must not start a search');
  });
  const pending = f.play();
  await flush();
  assert.deepEqual(f.appended, []);
  t.mock.timers.tick(1_200);
  await pending;
  assert.deepEqual(f.appended, ['move-played']);
  assert.equal(f.room.projection.state.status.type, 'finished');
  assert.equal(f.room.pendingDebugArtifacts?.[0]?.payload.pace_reason, 'decisive');
  assert.equal(f.room.pendingDebugArtifacts?.[0]?.payload.engine_move, null);
});

test('Three Kingdoms: the whole decision payload hides covered identities', async (t) => {
  const f = fixture(t, 'three-kingdoms-banqi');
  const run = async () => {
    const pending = f.play();
    await flush();
    t.mock.timers.tick(12_000);
    await pending;
    return JSON.stringify(f.room.pendingDebugArtifacts?.[0]?.payload);
  };
  const initial = f.room.projection.state;
  const clock = structuredClone(f.room.projection.clock);
  const original = await run();
  const board = { ...initial.board };
  const keys = Object.keys(board) as (keyof typeof board)[];
  const a = keys[0]!;
  const b = keys.find((key) => JSON.stringify(board[key]) !== JSON.stringify(board[a]));
  assert.ok(b);
  [board[a], board[b]] = [board[b], board[a]];
  f.room.projection.state = { ...initial, board };
  t.mock.timers.setTime(1_800_000_000_000);
  f.room.projection.clock = clock;
  f.room.pendingDebugArtifacts = [];
  f.room.events = f.room.events.filter((event) => event.type !== 'move-played');
  assert.equal(await run(), original);
  assert.doesNotMatch(original, /"(?:board|deal|setup)":/);
});
