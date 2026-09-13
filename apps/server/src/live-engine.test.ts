import assert from 'node:assert/strict';
import test from 'node:test';
import { type GameEvent, type GameState, initialGameProjection, type Move } from '@mistboard/game';
import type { EngineDefinition, EngineId, EngineMoveContext } from './engine-registry.js';
import {
  chooseLiveEngineMove,
  type LiveEngineFallbackEvent,
  liveEngineComputeBudgetMs,
  pythonLiveTimeoutBudgetMs,
  pythonLiveWatchdogTimeoutMs,
} from './live-engine.js';

const legalMove: Move = { from: 'e2', to: 'e4' };
const alternateLegalMove: Move = { from: 'd2', to: 'd4' };
const illegalMove: Move = { from: 'e2', to: 'e5' };

test('live engine move uses selected engine decision when legal', async () => {
  const engine = testEngine('selected', legalMove);
  const result = await chooseLiveEngineMove({
    context: context([legalMove]),
    engine,
  });

  assert.equal(result.engineId, 'selected');
  assert.equal(result.fallback, false);
  assert.deepEqual(result.decision.move, legalMove);
});

test('live engine move falls back when selected engine throws', async () => {
  const events: LiveEngineFallbackEvent[] = [];
  const result = await chooseLiveEngineMove({
    context: context([legalMove, alternateLegalMove]),
    engine: {
      ...testEngine('selected', legalMove),
      chooseMove() {
        throw new Error('engine crashed');
      },
    },
    onFallback: (event) => events.push(event),
  });

  assert.equal(result.engineId, 'builtin-random-legal');
  assert.equal(result.fallback, true);
  assert.ok([legalMove, alternateLegalMove].some((move) => sameMove(move, result.decision.move)));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.engineId, 'selected');
  assert.equal(events[0]?.fallbackEngineId, 'builtin-random-legal');
  assert.equal(events[0]?.reason, 'internal_error');
  assert.equal(events[0]?.ply, 4);
});

test('live engine move falls back when selected engine returns illegal move', async () => {
  const events: LiveEngineFallbackEvent[] = [];
  const result = await chooseLiveEngineMove({
    context: context([legalMove]),
    engine: testEngine('selected', illegalMove),
    onFallback: (event) => events.push(event),
  });

  assert.equal(result.engineId, 'builtin-random-legal');
  assert.deepEqual(result.decision.move, legalMove);
  assert.equal(events[0]?.reason, 'illegal_move');
});

test('live engine fallback reports timeout budget', async () => {
  const events: LiveEngineFallbackEvent[] = [];
  const result = await chooseLiveEngineMove({
    context: context([legalMove]),
    engine: {
      ...testEngine('slow-selected', legalMove),
      livePolicy: { timeoutMs: 1 },
      chooseMove: (() => {
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                move: legalMove,
                scores: [{ move: legalMove, score: 1, reason: 'slow-test' }],
              }),
            20,
          );
        });
      }) as unknown as EngineDefinition['chooseMove'],
    },
    onFallback: (event) => events.push(event),
  });

  assert.equal(result.engineId, 'builtin-random-legal');
  assert.equal(result.fallback, true);
  assert.equal(events[0]?.reason, 'timeout');
  assert.equal(events[0]?.timeoutMs, 1);
});

test('live engine move respects disabled fallback policy', async () => {
  await assert.rejects(
    chooseLiveEngineMove({
      context: context([legalMove]),
      engine: {
        ...testEngine('selected', illegalMove),
        livePolicy: { fallbackEngineId: null },
      },
    }),
    /illegal move/,
  );
});

test('python live engine fails closed when room event context is missing', async () => {
  const events: LiveEngineFallbackEvent[] = [];
  await assert.rejects(
    chooseLiveEngineMove({
      context: context([legalMove]),
      engine: {
        ...testEngine('python-selected', illegalMove),
        kind: 'container',
        config: { kind: 'python-subprocess', strategy: 'test', version: 1 },
        chooseMove: undefined,
      },
      onFallback: (event) => events.push(event),
    }),
    /requires live room events/,
  );

  assert.equal(events.length, 0);
});

test('python live engine fails closed when internal engine service is not configured', async () => {
  const previousUrl = process.env.MISTBOARD_INTERNAL_ENGINE_URL;
  const previousToken = process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN;
  const events: LiveEngineFallbackEvent[] = [];
  try {
    delete process.env.MISTBOARD_INTERNAL_ENGINE_URL;
    delete process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN;

    await assert.rejects(
      chooseLiveEngineMove({
        context: remoteEngineContext([legalMove]),
        engine: {
          ...testEngine('python-selected', illegalMove),
          kind: 'container',
          config: { kind: 'python-subprocess', strategy: 'test', version: 1 },
          chooseMove: undefined,
        },
        onFallback: (event) => events.push(event),
      }),
      /internal engine service URL\/token is not configured/,
    );

    assert.equal(events.length, 0);
  } finally {
    restoreEnv('MISTBOARD_INTERNAL_ENGINE_URL', previousUrl);
    restoreEnv('MISTBOARD_INTERNAL_ENGINE_TOKEN', previousToken);
  }
});

test('python live watchdog is a liveness bound decoupled from the compute budget', () => {
  // With a fat clock the watchdog rides the 60s hang cap, NOT compute+overhead:
  // deriving it from the allocation forfeited a 228s-clock game over one slow
  // belief-update turn (12c8ff99, engine issue #11). The engine self-budgets;
  // overspending shows up as flag-fall, not a watchdog forfeit.
  const budget = pythonLiveTimeoutBudgetMs(
    {
      ...context([legalMove]),
      clockRemainingMs: 180_000,
      incrementMs: 2_000,
    },
    5_000,
  );
  const timeoutMs = pythonLiveWatchdogTimeoutMs(
    {
      ...context([legalMove]),
      clockRemainingMs: 180_000,
      incrementMs: 2_000,
    },
    5_000,
  );

  assert.equal(budget.computeBudgetMs, 12_000);
  assert.equal(budget.watchdogTimeoutMs, 60_000);
  assert.equal(timeoutMs, 60_000);
});

test('python live watchdog budget can be tuned by environment', () => {
  const previous = process.env.PYTHON_LIVE_MOVES_REMAINING_ESTIMATE;
  process.env.PYTHON_LIVE_MOVES_REMAINING_ESTIMATE = '40';
  try {
    const budget = pythonLiveTimeoutBudgetMs(
      {
        ...context([legalMove]),
        clockRemainingMs: 180_000,
        incrementMs: 2_000,
      },
      5_000,
    );

    assert.ok(budget.computeBudgetMs >= 6_400);
    assert.ok(budget.computeBudgetMs <= 6_600);
    // Allocation knobs tune the compute budget only; the watchdog (liveness)
    // is independent of them by design.
    assert.equal(budget.watchdogTimeoutMs, 60_000);
  } finally {
    if (previous === undefined) delete process.env.PYTHON_LIVE_MOVES_REMAINING_ESTIMATE;
    else process.env.PYTHON_LIVE_MOVES_REMAINING_ESTIMATE = previous;
  }
});

test('python live watchdog stays bounded under clock pressure', () => {
  const budget = pythonLiveTimeoutBudgetMs(
    {
      ...context([legalMove]),
      clockRemainingMs: 900,
      incrementMs: 0,
    },
    5_000,
  );
  const timeoutMs = pythonLiveWatchdogTimeoutMs(
    {
      ...context([legalMove]),
      clockRemainingMs: 900,
      incrementMs: 0,
    },
    5_000,
  );

  assert.equal(budget.computeBudgetMs, 50);
  assert.equal(budget.watchdogTimeoutMs, 1_900);
  assert.equal(timeoutMs, 1_900);
});

// The number the live-engine-decision artifact records as movetime_ms. It has to
// be the allocator's own output: a second formula in the writer would drift on
// the next knob change and the artifact would describe a budget no engine was
// ever handed, which is worse than recording none.
test('the recorded compute budget is the allocator output for a python engine', () => {
  const pythonEngine: EngineDefinition = {
    ...testEngine('python-selected', legalMove),
    kind: 'container',
    config: { kind: 'python-subprocess', strategy: 'test', version: 1 },
    chooseMove: undefined,
  };
  const moveContext = { ...context([legalMove]), clockRemainingMs: 180_000, incrementMs: 2_000 };

  assert.equal(
    liveEngineComputeBudgetMs(pythonEngine, moveContext, 5_000),
    pythonLiveTimeoutBudgetMs(moveContext, 5_000).computeBudgetMs,
  );
  assert.equal(liveEngineComputeBudgetMs(pythonEngine, moveContext, 5_000), 12_000);
});

test('an engine with no time budget reports null, not zero', () => {
  // The in-process builtin engines are handed no movetime at all. Zero would
  // read as an engine starved of time, which is a different (and false) claim.
  assert.equal(
    liveEngineComputeBudgetMs(testEngine('builtin', legalMove), {
      ...context([legalMove]),
      clockRemainingMs: 180_000,
      incrementMs: 2_000,
    }),
    null,
  );
});

test('the recorded budget uses the engine own live timeout, as the move itself does', () => {
  // chooseLiveEngineMove resolves the timeout as `livePolicy?.timeoutMs ??
  // timeoutMs`, and that value reaches the allocator as the UNTIMED fallback —
  // so on a clockless room the two must not disagree.
  const pythonEngine: EngineDefinition = {
    ...testEngine('python-selected', legalMove),
    kind: 'container',
    config: { kind: 'python-subprocess', strategy: 'test', version: 1 },
    livePolicy: { timeoutMs: 7_000 },
    chooseMove: undefined,
  };

  assert.equal(liveEngineComputeBudgetMs(pythonEngine, context([legalMove]), 5_000), 7_000);
});

function testEngine(id: string, move: Move): EngineDefinition {
  return {
    // Synthetic fixture: intentionally a non-registry id, hence the assertion.
    id: id as EngineId,
    engineId: id,
    engineName: id,
    name: id,
    kind: 'builtin',
    configHash: id,
    playSignature: id,
    config: { kind: 'builtin', strategy: 'test', version: 1 },
    chooseMove() {
      return {
        move,
        scores: [{ move, score: 1, reason: 'test' }],
      };
    },
  };
}

function context(legalMoves: Move[]): EngineMoveContext {
  return {
    color: 'black',
    legalMoves,
    ply: 4,
    seed: 1n,
    state: {} as GameState,
  };
}

function remoteEngineContext(legalMoves: Move[]): EngineMoveContext {
  const roomId = 'remote-engine-room';
  const gameEvents: GameEvent[] = [{ type: 'room-created', at: 1, roomId, variant: 'dark-chess' }];
  return {
    ...context(legalMoves),
    events: gameEvents,
    roomId,
    state: initialGameProjection(roomId, 'dark-chess').state,
  };
}

function sameMove(left: Move, right: Move): boolean {
  return (
    left.from === right.from &&
    left.to === right.to &&
    (left.promotion ?? null) === (right.promotion ?? null)
  );
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
