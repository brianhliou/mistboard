import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  applyBanqiMove,
  type BanqiGameState,
  getBanqiLegalMoves,
  getJungleFlipLegalMoves,
  getJungleLegalMoves,
} from '@mistboard/game';
import { banqiMoveToEngineUci } from './banqi-fen.js';
import { banqiTenant } from './banqi-tenant.js';
import { jungleMoveToEngineUci } from './jungle-fen.js';
import { jungleFlipMoveToEngineUci } from './jungle-flip-fen.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import { playBanqiEngineMoveIfReady } from './server-banqi-engine.js';
import { playJungleEngineMoveIfReady } from './server-jungle-engine.js';
import { playJungleFlipEngineMoveIfReady } from './server-jungle-flip-engine.js';
import { clearTenantRuntimeTimers } from './variant-tenant/lifecycle.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  tenantClockRemainingMs,
  tenantPauseEventFor,
  tenantResumeEventFor,
} from './variant-tenant/runtime.js';

const CASES = [
  'banqi',
  'banqi-provider',
  'jungle-ts',
  'jungle-rust',
  'jungle-katago',
  'jungle-flip',
] as const;
type Case = (typeof CASES)[number];

function setEnv(t: TestContext, key: string, value: string) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function fixture(t: TestContext, path: Case) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  for (const key of [
    'MISTBOARD_BANQI_ENABLED',
    'MISTBOARD_JUNGLE_ENABLED',
    'MISTBOARD_JUNGLE_FLIP_ENABLED',
  ])
    setEnv(t, key, 'true');
  setEnv(t, 'MISTBOARD_BOT_PACING', 'true');
  setEnv(t, 'MISTBOARD_BOT_PACING_VARIANTS', 'banqi,jungle,jungle-flip');
  setEnv(t, 'MISTBOARD_JUNGLE_RUST_ENGINE', path === 'jungle-rust' ? 'true' : 'false');
  // Only the injected provider runs; these paths satisfy the existing asset gates.
  setEnv(t, 'MISTBOARD_JUNGLE_ENGINE_PATH', process.execPath);
  setEnv(t, 'MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH', process.execPath);
  setEnv(t, 'MISTBOARD_KATAGO_JUNGLE_NET_PATH', process.execPath);
  const tenant = path.startsWith('banqi')
    ? banqiTenant
    : path === 'jungle-flip'
      ? jungleFlipTenant
      : jungleTenant;
  const engineId = path.startsWith('banqi')
    ? 'misty-banqi'
    : path === 'jungle-flip'
      ? 'misty-jungle-flip'
      : path === 'jungle-katago'
        ? 'katago-jungle'
        : 'misty-jungle-level-2';
  const id = `pace_${path}`;
  const options = { now: Date.now(), timeControl: { initialMs: 60_000, incrementMs: 1_000 } };
  const created = path.startsWith('banqi')
    ? createTenantRuntimeRoom(banqiTenant, id, options)
    : path === 'jungle-flip'
      ? createTenantRuntimeRoom(jungleFlipTenant, id, options)
      : createTenantRuntimeRoom(jungleTenant, id, options);
  assert.ok(created.ok);
  const room = Object.assign(created.room, { clients: new Set<never>() });
  const append = (event: unknown) =>
    appendTenantRuntimeEvent(tenant as never, room as never, event as never);
  for (const [seat, clientId] of [
    ['red', engineId],
    ['black', 'human'],
  ] as const)
    append({ type: 'seat-assigned', roomId: id, at: Date.now(), seat, clientId });
  // Exercise a running bot clock even on its first move.
  room.projection.clock!.activeColor = 'red';
  room.projection.clock!.runningSince = Date.now();
  const appended: string[] = [];
  const ctx = {
    appendEvent: async (_target: unknown, event: { type: string }) => {
      appended.push(event.type);
      assert.ok(room.pendingDebugArtifacts?.length, 'queue the decision before terminal append');
      return append(event);
    },
    broadcastEventAppended: () => {},
  };
  const legal = () =>
    path.startsWith('banqi')
      ? getBanqiLegalMoves(room.projection.state as never)
      : path === 'jungle-flip'
        ? getJungleFlipLegalMoves(room.projection.state as never)
        : getJungleLegalMoves(room.projection.state as never);
  const uci = () => {
    const move = legal()[0]!;
    return path.startsWith('banqi')
      ? banqiMoveToEngineUci(move as never)
      : path === 'jungle-flip'
        ? jungleFlipMoveToEngineUci(move as never)
        : jungleMoveToEngineUci(move as never);
  };
  const caps: number[] = [];
  let providerHook: () => undefined | string | null = () => undefined;
  const provider = Object.assign(
    async (_id: string, _fen: string, opts: { movetimeCapMs?: number }) => {
      caps.push(opts.movetimeCapMs!);
      const best = providerHook();
      return { best: best === undefined ? uci() : best, cp: null, mate: null, depth: 1 };
    },
    path === 'banqi-provider'
      ? { failurePolicy: 'fail-closed' as const, engineVersion: 'test-provider' }
      : {},
  );
  const play = () =>
    path.startsWith('banqi')
      ? playBanqiEngineMoveIfReady(ctx as never, room as never, provider)
      : path === 'jungle-flip'
        ? playJungleFlipEngineMoveIfReady(ctx as never, room as never, provider)
        : playJungleEngineMoveIfReady(
            ctx as never,
            room as never,
            provider,
            async (fen, _seat, opts) => provider(engineId, fen, opts),
          );
  t.after(() => clearTenantRuntimeTimers(room as never));
  return {
    room,
    append,
    appended,
    play,
    caps,
    setProviderHook: (hook: () => undefined | string | null) => {
      providerHook = hook;
    },
  };
}

// Let the provider, guard and loop reach the hold without advancing wall time.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

for (const path of CASES) {
  test(`${path}: holds replies on the bot clock and logs compute separately`, async (t) => {
    const f = fixture(t, path);
    const pending = f.play();
    await flush();
    assert.deepEqual(f.appended, [], 'instant search must wait before append');
    t.mock.timers.tick(10_000);
    await pending;
    assert.deepEqual(f.appended, ['move-played']);
    const payload = f.room.pendingDebugArtifacts![0]!.payload;
    assert.equal(payload.pace_reason, 'paced');
    assert.ok(Number(payload.pace_wait_ms) >= 700);
    assert.equal(payload.think_time_ms, 0);
    assert.equal(f.room.events.at(-1)!.at, Date.now());
    assert.equal(
      tenantClockRemainingMs(f.room.projection.clock!, 'red', Date.now()),
      51_000,
      'hold is charged before increment',
    );
  });

  for (const interruption of [
    'resign',
    'abort',
    'restore',
    'pause-resume',
    'close',
    'shutdown',
    'elapsed-clock',
    'seat-change',
    'at-deadline',
  ] as const) {
    test(`${path}: ${interruption} discards the held reply and artifact`, async (t) => {
      const f = fixture(t, path);
      const pending = f.play();
      await flush();
      const common = { roomId: f.room.id, at: Date.now() };
      switch (interruption) {
        case 'resign':
          f.append({ ...common, type: 'seat-resigned', color: 'black' });
          break;
        case 'abort':
          f.append({ ...common, type: 'game-aborted', reason: 'user-abort' });
          break;
        // No live takeback endpoint exists for these tenants. Model restoration
        // with the dangerous same-seat-to-move state replacement.
        case 'restore':
          f.room.projection.state = { ...f.room.projection.state };
          break;
        case 'pause-resume': {
          const pause = tenantPauseEventFor(f.room.projection as never, Date.now(), 'shutdown');
          assert.ok(pause);
          f.append(pause);
          f.append(
            tenantResumeEventFor(f.room.projection as never, Date.now(), 'players-returned'),
          );
          break;
        }
        case 'close':
          clearTenantRuntimeTimers(f.room as never);
          break;
        case 'shutdown':
          Object.assign(f.room, { stopping: true });
          break;
        case 'elapsed-clock':
          f.room.projection.clock!.runningSince = Date.now() - 60_001;
          break;
        case 'at-deadline':
          // Resolve the wait, then end the room before the async continuation.
          t.mock.timers.tick(10_000);
          f.append({ ...common, type: 'game-aborted', reason: 'user-abort' });
          break;
        case 'seat-change':
          f.room.projection.seats.red = 'replacement-human';
          break;
      }
      t.mock.timers.tick(25);
      await pending;
      assert.deepEqual(f.appended, []);
      assert.equal(f.room.pendingDebugArtifacts?.length ?? 0, 0);
    });
  }

  for (const exclusion of [
    'master-off',
    'variant-off',
    'eve',
    'correspondence',
    'low-clock',
  ] as const) {
    test(`${path}: ${exclusion} skips the hold`, async (t) => {
      const f = fixture(t, path);
      if (exclusion === 'master-off') setEnv(t, 'MISTBOARD_BOT_PACING', 'false');
      if (exclusion === 'variant-off') setEnv(t, 'MISTBOARD_BOT_PACING_VARIANTS', 'xiangqi,jieqi');
      if (exclusion === 'eve') f.room.projection.seats.black = f.room.projection.seats.red;
      if (exclusion === 'correspondence')
        f.room.projection.timeControl = { initialMs: 86_400_000, incrementMs: 0, daysPerMove: 1 };
      if (exclusion === 'low-clock') f.room.projection.clock!.remainingMs.red = 9_000;
      await f.play();
      assert.deepEqual(f.appended, ['move-played']);
      assert.equal(f.room.pendingDebugArtifacts![0]!.payload.pace_wait_ms, 0);
      assert.equal(
        f.room.pendingDebugArtifacts![0]!.payload.pace_reason,
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

  if (path !== 'jungle-ts') {
    test(`${path}: search allocation preserves the 1+1 reserve`, async (t) => {
      const f = fixture(t, path);
      f.room.projection.clock!.remainingMs.red = 6_100;
      f.setProviderHook(() => {
        assert.ok(f.caps.at(-1)! <= 100, 'search cannot spend the 6000 ms reserve');
        t.mock.timers.tick(200);
        return undefined;
      });
      await f.play();
      assert.deepEqual(f.appended, ['move-played']);
      assert.equal(f.room.pendingDebugArtifacts![0]!.payload.pace_reason, 'low-clock');
    });
    test(`${path}: cleanup during search discards the reply`, async (t) => {
      const f = fixture(t, path);
      f.setProviderHook(() => {
        clearTenantRuntimeTimers(f.room as never);
        return null;
      });
      await f.play();
      assert.deepEqual(f.appended, []);
      assert.equal(f.room.pendingDebugArtifacts?.length ?? 0, 0);
    });
  }
}

for (const path of ['banqi', 'jungle-rust', 'jungle-katago', 'jungle-flip'] as const) {
  test(`${path}: retry cannot spend clock already used by the first attempt`, async (t) => {
    const f = fixture(t, path);
    f.room.projection.clock!.remainingMs.red = 6_100;
    f.setProviderHook(() => {
      t.mock.timers.tick(100);
      return null;
    });
    await f.play();
    assert.equal(f.caps.length, 1, 'do not launch a second search at the reserve');
    assert.deepEqual(f.appended, [], 'exhaustion cancels instead of resigning');
    assert.equal(f.room.pendingDebugArtifacts?.length ?? 0, 0);
  });
}

for (const path of ['banqi', 'banqi-provider', 'jungle-flip'] as const) {
  test(`${path}: serialized decision is invariant to covered piece identities`, async (t) => {
    const first = fixture(t, path);
    const run = async (f: ReturnType<typeof fixture>) => {
      const pending = f.play();
      await flush();
      t.mock.timers.tick(10_000);
      await pending;
      return JSON.stringify(f.room.pendingDebugArtifacts![0]!.payload);
    };
    const original = await run(first);
    t.mock.timers.reset();
    const second = fixture(t, path);
    const state = second.room.projection.state;
    const board = { ...state.board };
    const a = Object.keys(board)[0]!;
    const b = Object.keys(board).find(
      (key) =>
        JSON.stringify(board[key as keyof typeof board]) !==
        JSON.stringify(board[a as keyof typeof board]),
    );
    assert.ok(b, 'swap distinct identities so the regression cannot be vacuous');
    Object.assign(board, {
      [a]: board[b as keyof typeof board],
      [b]: board[a as keyof typeof board],
    });
    assert.notDeepEqual(board, state.board);
    second.room.projection.state = { ...state, board } as typeof state;
    assert.equal(
      await run(second),
      original,
      'the entire artifact must depend only on the public position',
    );
    assert.doesNotMatch(original, /"(?:board|deal|setup)":/);
  });
}

test('banqi: the chase fallback passes through the same hold', async (t) => {
  const f = fixture(t, 'banqi');
  let state: BanqiGameState = {
    id: f.room.id,
    board: {
      c3: { color: 'red', role: 'advisor', faceDown: false },
      d2: { color: 'black', role: 'chariot', faceDown: false },
      h1: { color: 'red', role: 'soldier', faceDown: false },
      a4: { color: 'black', role: 'soldier', faceDown: false },
      f4: { color: 'black', role: 'horse', faceDown: true },
    },
    status: { type: 'playing', turn: 'red' },
    ply: 10,
    firstColor: 'red',
    moveNumber: 6,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
    lastMove: { from: 'e2', to: 'd2' },
    noProgressLimit: 60,
    chaseRule: 'repetition',
  };
  for (let i = 0; i < 2; i++)
    for (const move of [
      { from: 'c3', to: 'c2' },
      { from: 'd2', to: 'd3' },
      { from: 'c2', to: 'c3' },
      { from: 'd3', to: 'd2' },
    ] as const)
      state = applyBanqiMove(state, move);
  f.room.projection.state = state;
  // This public move is the forbidden third chase in the fixture.
  f.setProviderHook(() => 'c2c1');
  const pending = f.play();
  await flush();
  assert.deepEqual(f.appended, []);
  t.mock.timers.tick(10_000);
  await pending;
  assert.equal(f.caps.length, 2);
  assert.deepEqual(f.appended, ['move-played']);
  assert.equal(f.room.pendingDebugArtifacts![0]!.payload.pace_reason, 'paced');
  assert.notEqual(f.room.pendingDebugArtifacts![0]!.payload.move, 'c2c1');
});
