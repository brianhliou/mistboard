import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_OPENINGS,
  type GomokuColor,
  type GomokuMove,
  type GomokuRoomState,
  parseRapfiOutput,
  RAPFI_LEVELS,
  rapfiGameSeed,
  rapfiPlySeed,
  selectRapfiMove,
} from '@mistboard/game';
import { ENGINE_FAILURE_ABORTED_REASON } from './engine-failure-abort.js';
import {
  type GomokuEngineContext,
  type GomokuMoveProvider,
  gomokuLiveEngineMove,
  playGomokuEngineMoveIfReady,
  scheduleGomokuEngineMove,
} from './gomoku-engine.js';
import { gomokuWs } from './gomoku-registration.js';
import { type GomokuRuntimeRoom, gomokuTenant } from './gomoku-tenant.js';
import { aggregateEnginePoolStats } from './uci-engine-harness.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import { resumeTenantRoom } from './variant-tenant/lifecycle.js';
import {
  appendTenantRuntimeEvent,
  createTenantClock,
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  tenantPauseEventFor,
} from './variant-tenant/runtime.js';
import { clearTenantRuntimeTimers, createTenantWsRuntime } from './variant-tenant/ws.js';

// Recorded structured INFO layout from the pinned 1387d11 build. Distinct
// candidates expose the seeded selection policy; MESSAGE text is not evidence.
const recorded =
  [414, 80, 0]
    .map(
      (score, pv) => `INFO PV ${pv}
INFO NUMPV 3
INFO DEPTH 11
INFO SELDEPTH 10
INFO NODES 2470
INFO TOTALNODES 4370
INFO TOTALTIME 48
INFO SPEED 91041
INFO EVAL ${score}
INFO WINRATE 0.887953
INFO BESTLINE ${5 + pv},6
INFO PV DONE`,
    )
    .join('\n') + '\nMESSAGE Eval 999 | A1\n5,6';

function fakeEngine(
  options: {
    output?: string;
    hang?: 'init' | 'search';
    delayMs?: number;
    reapMs?: number;
    ignoreEnd?: boolean;
  } = {},
) {
  const commands: string[][] = [];
  const kills: string[] = [];
  let active = 0;
  let peak = 0;
  let closed = 0;
  const spawnProcess = () => {
    peak = Math.max(peak, ++active);
    const lines: string[] = [];
    commands.push(lines);
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let reaping = false;
    const close = () => {
      if (reaping) return;
      reaping = true;
      setTimeout(() => {
        active--;
        closed++;
        stdout.end();
        stderr.end();
        child.emit('close', 0, null);
      }, options.reapMs ?? 0);
    };
    const reply = () => {
      if (options.hang === 'search') return;
      setTimeout(() => {
        const output = `${options.output ?? recorded}\n`;
        stdout.write(output.slice(0, 17));
        stdout.write(output.slice(17));
      }, options.delayMs ?? 0);
    };
    let board = '';
    const stdin = new Writable({
      write(chunk, _encoding, done) {
        for (const line of chunk.toString().trimEnd().split('\n')) {
          lines.push(line);
          if (line === 'START 15' && options.hang !== 'init')
            queueMicrotask(() => stdout.write('OK\n'));
          if (line === 'BOARD' || line === 'YXBOARD') board = line;
          if (
            line.startsWith('YXNBEST ') ||
            line === 'BEGIN' ||
            (line === 'DONE' && board === 'BOARD')
          )
            reply();
          if (line === 'END' && !options.ignoreEnd) queueMicrotask(close);
        }
        done();
      },
    });
    return Object.assign(child, {
      stdin,
      stdout,
      stderr,
      kill(signal: string) {
        kills.push(signal);
        close();
        return true;
      },
    }) as unknown as ChildProcessWithoutNullStreams;
  };
  return { spawnProcess, commands, kills, counts: () => ({ active, peak, closed }) };
}

const rooms: GomokuRuntimeRoom[] = [];
const cap = process.env.RAPFI_MAX_PROCESSES;
const totalCap = process.env.MISTBOARD_ENGINE_MAX_PROCESSES;
afterEach(() => {
  for (const room of rooms.splice(0)) clearTenantRuntimeTimers(room);
  if (cap === undefined) delete process.env.RAPFI_MAX_PROCESSES;
  else process.env.RAPFI_MAX_PROCESSES = cap;
  if (totalCap === undefined) delete process.env.MISTBOARD_ENGINE_MAX_PROCESSES;
  else process.env.MISTBOARD_ENGINE_MAX_PROCESSES = totalCap;
});

function fixture(seat: GomokuColor = 'black', level = 1, state?: GomokuRoomState) {
  const created = createTenantRuntimeRoom(
    {
      ...gomokuTenant,
      rules: {
        ...gomokuTenant.rules,
        createSetup: () => state?.opening ?? { stones: [], turn: 'black' },
      },
    },
    `gmk_server_${rooms.length}`,
  );
  assert.ok(created.ok);
  const room = created.room as Parameters<typeof gomokuWs.handleConnection>[3];
  rooms.push(room);
  for (const color of gomokuTenant.colors)
    appendTenantRuntimeEvent(gomokuTenant, room, {
      type: 'seat-assigned',
      at: Date.now(),
      roomId: room.id,
      seat: color,
      clientId: color === seat ? `rapfi-level-${level}` : 'human-player',
    });
  if (state) room.projection.state = { ...state, id: room.id };
  const broadcasts: string[] = [];
  const ctx: GomokuEngineContext = {
    appendEvent: async (target, event) => {
      appendTenantRuntimeEvent(gomokuTenant, target, event);
      return target.events.length - 1;
    },
    broadcastEventAppended: (_room, event) => {
      broadcasts.push(event.type);
    },
  };
  return { room, ctx, broadcasts };
}

test('Rapfi shared policy pins every calibrated dial and seeded identity', () => {
  assert.deepEqual(RAPFI_LEVELS, [
    { level: 1, nodes: 5000, timeMs: 1000, candidateCount: 64, evalMargin: 20000 },
    { level: 2, nodes: 5500, timeMs: 1000, candidateCount: 64, evalMargin: 20000, bestRate: 0.6 },
    { level: 3, nodes: 6000, timeMs: 1500, candidateCount: 64, evalMargin: 20000, bestRate: 0.85 },
    { level: 4, nodes: 8000, timeMs: 1500, candidateCount: 8, evalMargin: 20000, bestRate: 0.9 },
    { level: 5, nodes: 10000, timeMs: 2000, candidateCount: 3, evalMargin: 20000, bestRate: 0.97 },
    { level: 6, nodes: 12000, timeMs: 1500 },
    { level: 7, nodes: 25000, timeMs: 2500 },
    { level: 8, nodes: 80000, timeMs: 3500 },
  ]);
  const game = rapfiGameSeed('room-17', 20261101);
  assert.deepEqual(
    [game, rapfiPlySeed(game, 8), rapfiGameSeed('五子棋', 0xffffffff)],
    [2735149948, 2854282940, 2440546783],
  );
});

test('server PvE gets a legal recorded-output reply at all eight levels and both colours', async () => {
  for (const tier of RAPFI_LEVELS) {
    for (const seat of ['black', 'white'] as const) {
      const opening = GOMOKU_OPENINGS.find((o) => o.turn === seat)!;
      const { room, ctx, broadcasts } = fixture(
        seat,
        tier.level,
        createGomokuRoomState('seed', opening),
      );
      const before = room.projection.state;
      const engine = fakeEngine();
      const provider: GomokuMoveProvider = (state, id, opts) =>
        gomokuLiveEngineMove(state, id, { ...engine, ...opts });
      await playGomokuEngineMoveIfReady(ctx, room, provider);
      const event = room.events.at(-1);
      assert.equal(event?.type, 'move-played');
      if (event?.type !== 'move-played') throw new Error('missing server reply');
      assert.equal(event.color, seat);
      assert.ok(gomokuTenant.rules.isLegalMove(before, event.move));
      const pos = {
        turn: seat === 'black' ? (1 as const) : (2 as const),
        stones: before.board.flatMap((color, index) =>
          color
            ? [
                {
                  x: index % 15,
                  y: Math.floor(index / 15),
                  player: color === 'black' ? (1 as const) : (2 as const),
                },
              ]
            : [],
        ),
      };
      if (tier.candidateCount) {
        const point = selectRapfiMove(pos, parseRapfiOutput(recorded), {
          candidateCount: tier.candidateCount,
          evalMargin: tier.evalMargin!,
          bestRate: tier.bestRate,
          seed: rapfiPlySeed(rapfiGameSeed(room.id), before.ply),
        });
        assert.equal(event.move.to, `${String.fromCharCode(97 + point.x)}${point.y + 1}`);
      } else assert.equal(event.move.to, 'f7');
      assert.equal(room.projection.state.ply, before.ply + 1);
      assert.deepEqual(broadcasts, ['move-played']);
      assert.deepEqual(engine.counts(), { active: 0, peak: 1, closed: 1 });
      const commands = engine.commands[0]!;
      for (const command of [
        `INFO max_node ${tier.nodes}`,
        `INFO timeout_turn ${tier.timeMs}`,
        'INFO thread_num 1',
        'INFO max_memory 33554432',
      ])
        assert.ok(commands.includes(command), command);
      assert.equal(
        commands.includes(`YXNBEST ${tier.candidateCount}`),
        tier.candidateCount !== undefined,
      );
      assert.equal(commands.at(-1), 'END');
    }
  }
});

test('empty legacy boards use BEGIN without requiring candidates', async () => {
  for (const tier of RAPFI_LEVELS) {
    const engine = fakeEngine({ output: '7,7' });
    assert.deepEqual(
      await gomokuLiveEngineMove(
        createGomokuRoomState('gmk_empty'),
        `rapfi-level-${tier.level}`,
        engine,
      ),
      { to: 'h8' },
    );
    assert.ok(engine.commands[0]!.includes('BEGIN'));
    assert.equal(engine.counts().active, 0);
  }
});

test('calibration seed and telemetry hooks preserve the live request and selected move', async () => {
  const opening = GOMOKU_OPENINGS[0]!;
  const state = createGomokuRoomState('live-seed-reference', opening);
  const reference = fakeEngine();
  const expected = await gomokuLiveEngineMove(state, 'rapfi-level-1', reference);
  const engine = fakeEngine();
  const searches: { move: GomokuMove; lines: string[]; elapsedMs: number }[] = [];
  const actual = await gomokuLiveEngineMove(
    { ...state, id: 'different-calibration-identity' },
    'rapfi-level-1',
    {
      ...engine,
      gameSeed: rapfiGameSeed(state.id),
      onSearch: (search) => searches.push(search),
    },
  );
  assert.deepEqual(actual, expected);
  assert.deepEqual(engine.commands, reference.commands);
  assert.equal(searches.length, 1);
  assert.deepEqual(searches[0]!.move, expected);
  assert.deepEqual(searches[0]!.lines, recorded.split('\n'));
  assert.ok(Number.isFinite(searches[0]!.elapsedMs) && searches[0]!.elapsedMs >= 0);
  assert.equal(engine.counts().active, 0);

  const invalid = fakeEngine();
  await assert.rejects(
    gomokuLiveEngineMove(state, 'rapfi-level-1', { ...invalid, gameSeed: -1 }),
    /Invalid Rapfi seed/,
  );
  assert.equal(invalid.commands.length, 0);
});

test('a failing search observer still reaps the native process and releases its slot', async () => {
  const engine = fakeEngine({ output: '7,7' });
  await assert.rejects(
    gomokuLiveEngineMove(createGomokuRoomState('observer-error'), 'rapfi-level-8', {
      ...engine,
      onSearch: () => {
        throw new Error('telemetry write failed');
      },
    }),
    /telemetry write failed/,
  );
  assert.equal(engine.counts().active, 0);
  assert.equal(aggregateEnginePoolStats().processes.active, 0);
});

test('live concurrency is global across rooms and slots include child reaping', async () => {
  process.env.RAPFI_MAX_PROCESSES = '1';
  const engine = fakeEngine({ delayMs: 10, reapMs: 10 });
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      gomokuLiveEngineMove(createGomokuRoomState(`gmk_cap_${index}`), 'rapfi-level-8', engine),
    ),
  );
  assert.deepEqual(engine.counts(), { active: 0, peak: 1, closed: 5 });
});

test('Rapfi also respects the physical process cap shared with other engines', async () => {
  process.env.RAPFI_MAX_PROCESSES = '2';
  process.env.MISTBOARD_ENGINE_MAX_PROCESSES = '1';
  const before = aggregateEnginePoolStats().processes.acquired;
  const engine = fakeEngine({ delayMs: 10, reapMs: 10 });
  await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      gomokuLiveEngineMove(createGomokuRoomState(`gmk_physical_${index}`), 'rapfi-level-8', engine),
    ),
  );
  assert.deepEqual(engine.counts(), { active: 0, peak: 1, closed: 4 });
  assert.equal(aggregateEnginePoolStats().processes.active, 0);
  assert.equal(aggregateEnginePoolStats().processes.acquired - before, 4);
});

test('watchdog kills and reaps hung initialization or search, then frees capacity', async () => {
  process.env.RAPFI_MAX_PROCESSES = '1';
  for (const hang of ['init', 'search'] as const) {
    const engine = fakeEngine({ hang });
    await assert.rejects(
      gomokuLiveEngineMove(createGomokuRoomState('gmk_hang'), 'rapfi-level-8', {
        ...engine,
        timeoutMs: 15,
      }),
      /timed out/,
    );
    assert.ok(engine.kills.includes('SIGKILL'));
    assert.deepEqual(engine.counts(), { active: 0, peak: 1, closed: 1 });
  }
  const engine = fakeEngine({ output: '7,7' });
  assert.deepEqual(
    await gomokuLiveEngineMove(createGomokuRoomState('gmk_next'), 'rapfi-level-1', engine),
    { to: 'h8' },
  );
});

test('a process ignoring END is killed before releasing its slot', async () => {
  const engine = fakeEngine({ ignoreEnd: true, output: '7,7' });
  await gomokuLiveEngineMove(createGomokuRoomState('gmk_end'), 'rapfi-level-8', engine);
  assert.deepEqual(engine.kills, ['SIGKILL']);
  assert.equal(engine.counts().active, 0);
});

test('engine errors, illegal moves and missing candidate output use the shared engine-failure abort', async () => {
  for (const output of ['ERROR unavailable network', '99,99', '5,6']) {
    const opening = GOMOKU_OPENINGS[0]!;
    const { room, ctx, broadcasts } = fixture(
      opening.turn,
      1,
      createGomokuRoomState('error', opening),
    );
    const engine = fakeEngine({ output });
    await playGomokuEngineMoveIfReady(ctx, room, (state, id, opts) =>
      gomokuLiveEngineMove(state, id, { ...engine, ...opts }),
    );
    assert.equal(room.projection.state.status.type, 'finished');
    assert.equal(room.events.at(-1)?.type, 'seat-forfeited');
    assert.deepEqual(broadcasts, ['seat-forfeited']);
    assert.deepEqual(buildTenantGameSummary(gomokuTenant, room).abortedAs, {
      termination: 'engine-failure',
      abortedReason: ENGINE_FAILURE_ABORTED_REASON,
    });
    assert.equal(engine.commands.length, 2, 'retry once before aborting');
    assert.equal(engine.counts().active, 0);
  }
});

test('a queued stale room never spawns a process', async () => {
  process.env.RAPFI_MAX_PROCESSES = '1';
  const engine = fakeEngine({ output: '7,7', delayMs: 15 });
  const first = gomokuLiveEngineMove(createGomokuRoomState('gmk_queue_1'), 'rapfi-level-8', engine);
  const stale = gomokuLiveEngineMove(createGomokuRoomState('gmk_queue_2'), 'rapfi-level-8', {
    ...engine,
    isCurrent: () => false,
  });
  assert.equal(await stale, null);
  await first;
  assert.equal(engine.commands.length, 1);
});

test('paused, finished, unfilled and human turns never compute a bot move', async () => {
  for (const change of ['pause', 'finish', 'empty', 'human'] as const) {
    const { room, ctx } = fixture();
    if (change === 'pause') room.projection.paused = { at: Date.now(), activeColor: 'black' };
    if (change === 'finish')
      room.projection.state = gomokuTenant.rules.finish(
        room.projection.state,
        'white',
        'resignation',
      );
    if (change === 'empty') delete room.projection.seats.white;
    if (change === 'human')
      room.projection.state = applyGomokuRoomMove(room.projection.state, { to: 'a1' });
    let calls = 0;
    await playGomokuEngineMoveIfReady(ctx, room, async () => {
      calls++;
      return { to: 'h8' };
    });
    assert.equal(calls, 0, change);
  }
});

test('duplicate scheduling coalesces; pause, resign and changed positions discard in-flight success and failure', async () => {
  for (const mutation of ['pause', 'resign', 'position'] as const) {
    for (const failure of [false, true]) {
      const { room, ctx, broadcasts } = fixture();
      let release!: () => void;
      let calls = 0;
      const provider: GomokuMoveProvider = async () => {
        calls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (failure) throw new Error('late failure');
        return { to: 'h8' };
      };
      const pending = playGomokuEngineMoveIfReady(ctx, room, provider);
      await playGomokuEngineMoveIfReady(ctx, room, provider);
      scheduleGomokuEngineMove(ctx, room, provider);
      assert.equal(calls, 1);
      if (mutation === 'pause') room.projection.paused = { at: Date.now(), activeColor: 'black' };
      if (mutation === 'resign')
        room.projection.state = gomokuTenant.rules.finish(
          room.projection.state,
          'white',
          'resignation',
        );
      // A restored position can have the same ply and turn, but a different board.
      if (mutation === 'position') {
        const board = [...room.projection.state.board];
        board[0] = 'white';
        room.projection.state = { ...room.projection.state, board };
      }
      release();
      await pending;
      clearTenantRuntimeTimers(room);
      assert.deepEqual(broadcasts, []);
      assert.equal(room.projection.state.ply, 0);
    }
  }
});

test('event writer schedules server replies; hydration preserves the bot seat and replay', async () => {
  // Exercise the same scheduler binding as gomokuWs, with recorded process I/O.
  assert.equal(typeof gomokuWs.lifecycleCtx.appendEvent, 'function');
  const engine = fakeEngine({ output: '7,7' });
  const provider: GomokuMoveProvider = (state, id, opts) =>
    gomokuLiveEngineMove(state, id, { ...engine, ...opts });
  const runtime = createTenantWsRuntime(gomokuTenant, {
    scheduleEngineMove: (ctx, room) => scheduleGomokuEngineMove(ctx, room, provider),
  });
  const { room } = fixture('white', 8);
  await runtime.lifecycleCtx.appendEvent(room, {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: 'black',
    move: { to: 'a1' },
  });
  const deadline = Date.now() + 2_000;
  while (room.projection.state.ply < 2 && Date.now() < deadline)
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(room.projection.state.ply, 2);
  assert.equal(room.events.at(-1)?.type, 'move-played');
  const loaded = createTenantRuntimeRoomFromEvents(gomokuTenant, room.events);
  assert.ok(loaded.ok);
  assert.equal(loaded.room.projection.seats.white, 'rapfi-level-8');
  assert.deepEqual(loaded.room.projection.state, room.projection.state);
});

test('a paused room schedules no work and the durable resume schedules its bot turn', async () => {
  const engine = fakeEngine({ output: '7,7' });
  const provider: GomokuMoveProvider = (state, id, opts) =>
    gomokuLiveEngineMove(state, id, { ...engine, ...opts });
  const runtime = createTenantWsRuntime(gomokuTenant, {
    scheduleEngineMove: (ctx, room) => scheduleGomokuEngineMove(ctx, room, provider),
  });
  const { room } = fixture('black', 8);
  room.projection.clock = createTenantClock(gomokuTenant, 180_000, 2_000);
  const pause = tenantPauseEventFor(room.projection, Date.now(), 'shutdown');
  assert.ok(pause);
  await runtime.lifecycleCtx.appendEvent(room, pause);
  assert.equal(room.engineTimer, null);
  assert.equal(engine.commands.length, 0);
  await resumeTenantRoom(gomokuTenant, room, runtime.lifecycleCtx, Date.now(), 'players-returned');
  const deadline = Date.now() + 2_000;
  while (room.projection.state.ply < 1 && Date.now() < deadline)
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(room.projection.state.ply, 1);
  assert.equal(room.projection.paused, undefined);
  assert.equal(engine.commands.length, 1);
});

test('reconnecting during a search preserves the position and lets the reply land', async () => {
  const { room, ctx, broadcasts } = fixture();
  let release!: () => void;
  const pending = playGomokuEngineMoveIfReady(ctx, room, async (_state, _id, options) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    assert.equal(options.isCurrent?.(), true);
    return { to: 'h8' };
  });
  // handleConnection durably appends this even when the human already owns the seat.
  await ctx.appendEvent(room, {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: room.id,
    seat: 'white',
    clientId: 'human-player',
  });
  // Restoring the same position in a fresh object must also remain current.
  room.projection.state = { ...room.projection.state, board: [...room.projection.state.board] };
  release();
  await pending;
  assert.equal(room.projection.state.ply, 1);
  assert.deepEqual(broadcasts, ['move-played']);
});

test('transient engine failure retries once and plays the recovered legal move', async () => {
  const { room, ctx, broadcasts } = fixture();
  let calls = 0;
  await playGomokuEngineMoveIfReady(ctx, room, async () => {
    if (++calls === 1) throw new Error('Rapfi spawn failed');
    return { to: 'h8' };
  });
  assert.equal(calls, 2);
  assert.equal(room.projection.state.ply, 1);
  assert.deepEqual(broadcasts, ['move-played']);
});

test('infrastructure failure aborts results before and after either bot seat has moved', async () => {
  for (const seat of ['black', 'white'] as const) {
    for (const played of [false, true]) {
      for (const error of [
        'spawn ENOENT',
        'spawn EACCES',
        'Rapfi PvE pool timed out',
        'Total engine process queue timed out',
      ]) {
        const { room, ctx } = fixture(seat);
        const moves: GomokuMove['to'][] = played ? ['a1', 'b1', 'a2', 'b2'] : [];
        if (seat === 'white') moves.push('a3');
        for (const to of moves) {
          const status = room.projection.state.status;
          assert.equal(status.type, 'playing');
          if (status.type !== 'playing') throw new Error('unexpected terminal fixture');
          appendTenantRuntimeEvent(gomokuTenant, room, {
            type: 'move-played',
            at: Date.now(),
            roomId: room.id,
            color: status.turn,
            move: { to },
          });
        }
        let calls = 0;
        await playGomokuEngineMoveIfReady(ctx, room, async () => {
          calls++;
          throw new Error(error);
        });
        assert.equal(calls, 2, error);
        assert.equal(room.events.at(-1)?.type, 'seat-forfeited', error);
        assert.deepEqual(buildTenantGameSummary(gomokuTenant, room).abortedAs, {
          termination: 'engine-failure',
          abortedReason: ENGINE_FAILURE_ABORTED_REASON,
        });
        assert.equal(buildTenantGameSummary(gomokuTenant, room).rated, false);
      }
    }
  }
});

test('default live capacity serves queued Level 8 rooms beyond the old five-second deadline', async (t) => {
  delete process.env.RAPFI_MAX_PROCESSES;
  const pool = aggregateEnginePoolStats().pools.find((p) => p.name === 'rapfi-gomoku-pve')!;
  // Force two slots so this also proves the queue deadline, independently of the cap.
  process.env.RAPFI_MAX_PROCESSES = '2';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = fakeEngine({ delayMs: 3_500, reapMs: 50, output: '7,7' });
  const pending = Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      gomokuLiveEngineMove(createGomokuRoomState(`gmk_burst_${i}`), 'rapfi-level-8', engine),
    ),
  );
  await nextTurn();
  for (let wave = 0; wave < 3; wave++) {
    t.mock.timers.tick(3_500);
    await nextTurn();
    t.mock.timers.tick(50);
    await nextTurn();
  }
  const results = await pending;
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 6);
  assert.deepEqual(engine.counts(), { active: 0, peak: 2, closed: 6 });
  assert.equal(pool.maxProcesses, 4);
});

test('fresh-process search watchdog allows cold network startup beyond the search budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = fakeEngine({ delayMs: 2_000, output: '7,7' });
  const pending = Promise.allSettled([
    gomokuLiveEngineMove(createGomokuRoomState('gmk_cold'), 'rapfi-level-1', engine),
  ]);
  await nextTurn();
  t.mock.timers.tick(2_000);
  await nextTurn();
  t.mock.timers.tick(1);
  await nextTurn();
  assert.deepEqual(await pending, [{ status: 'fulfilled', value: { to: 'h8' } }]);
  assert.deepEqual(engine.kills, []);
  assert.equal(engine.counts().closed, 1);
});
