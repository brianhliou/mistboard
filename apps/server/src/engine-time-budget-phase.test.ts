import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type BotTimeRule,
  botMoveNumber,
  botTimeRule,
  budgetForMove,
  effectiveTimeRule,
  liveBotMoveTime,
  NATIVE_TIME,
  NATIVE_TIME_ENGINE_IDS,
  nativeClockForMove,
  nativeRuleApplies,
  nativeWatchdogMs,
  PHASE_TIME,
  PHASE_TIME_ENGINE_IDS,
  paceAwareMovetimeMs,
  phaseBudgetForMove,
  phaseRuleApplies,
  uciClockWords,
} from './engine-time-budget.js';
import { jieqiEngineTierFor } from './jieqi-engine.js';
import { xiangqiEngineTierFor } from './xiangqi-engine-catalog.js';

const ONE_PLUS_ONE = { initialMs: 60_000, incrementMs: 1_000 };
const CEIL = 4_000;

type Allocator = (remainingMs: number, botMove: number) => number;

/** The bot's `botMove`-th move as red (plies 0, 2, ...) or black (1, 3, ...). */
const plyOf = (botMove: number, side: 'red' | 'black') =>
  2 * (botMove - 1) + (side === 'red' ? 0 : 1);

const phaseAllocator =
  (incrementMs: number, side: 'red' | 'black' = 'red', ceilingMs = CEIL): Allocator =>
  (remainingMs, botMove) =>
    phaseBudgetForMove({ remainingMs, incrementMs, ceilingMs, ply: plyOf(botMove, side) })
      .computeBudgetMs;

/**
 * Plays `moves` bot moves on a Fischer clock where every move runs its movetime
 * plus `overrunMs` (the engine overshooting up to its allowance), and returns the
 * lowest clock seen after the increment and whether it ever flagged.
 */
function simulate(
  allocate: Allocator,
  tc: { initialMs: number; incrementMs: number },
  moves: number,
  overrunMs: (botMove: number) => number,
): { lowestMs: number; flagged: boolean; budgets: number[]; clockAt: number[] } {
  let clock = tc.initialMs;
  let lowestMs = clock;
  let flagged = false;
  const budgets: number[] = [];
  const clockAt: number[] = [];
  for (let move = 1; move <= moves; move++) {
    clockAt.push(clock);
    const budget = allocate(clock, move);
    budgets.push(budget);
    const spent = budget + overrunMs(move);
    if (spent >= clock) {
      flagged = true;
      break;
    }
    clock = clock - spent + tc.incrementMs;
    lowestMs = Math.min(lowestMs, clock);
  }
  return { lowestMs, flagged, budgets, clockAt };
}

test('the switch is off unless MISTBOARD_BOT_TIME_RULE=phase', () => {
  assert.equal(botTimeRule({}), 'flat');
  assert.equal(botTimeRule({ MISTBOARD_BOT_TIME_RULE: 'flat' }), 'flat');
  assert.equal(botTimeRule({ MISTBOARD_BOT_TIME_RULE: 'yes' }), 'flat');
  assert.equal(botTimeRule({ MISTBOARD_BOT_TIME_RULE: 'phase' }), 'phase');
  assert.equal(botTimeRule({ MISTBOARD_BOT_TIME_RULE: 'native' }), 'native');
});

test('every phase-rule engine id still resolves to a live tier', () => {
  for (const id of PHASE_TIME_ENGINE_IDS) {
    assert.ok(xiangqiEngineTierFor(id) ?? jieqiEngineTierFor(id), `${id} is not a live tier`);
  }
});

test('the phase rule applies only to top tiers, short clocks with an increment, when on', () => {
  const base = { rule: 'phase' as BotTimeRule, engineId: 'pikafish-xiangqi-level-8' };
  assert.equal(phaseRuleApplies({ ...base, ...ONE_PLUS_ONE }), true);
  assert.equal(phaseRuleApplies({ ...base, initialMs: 180_000, incrementMs: 2_000 }), true);
  assert.equal(phaseRuleApplies({ ...base, initialMs: 300_000, incrementMs: 5_000 }), false);
  assert.equal(phaseRuleApplies({ ...base, initialMs: 60_000, incrementMs: 0 }), false);
  assert.equal(phaseRuleApplies({ ...base, initialMs: null, incrementMs: 0 }), false);
  assert.equal(phaseRuleApplies({ ...base, rule: 'flat', ...ONE_PLUS_ONE }), false);
  assert.equal(
    phaseRuleApplies({ ...base, engineId: 'fairy-stockfish-xiangqi-level-7', ...ONE_PLUS_ONE }),
    false,
  );
});

test('bot move numbers count the bot’s own moves from the ply', () => {
  assert.equal(botMoveNumber(0), 1);
  assert.equal(botMoveNumber(1), 1);
  assert.equal(botMoveNumber(2), 2);
  assert.equal(botMoveNumber(11), 6);
});

test('only the game’s first move is quick: red’s move 1, never black’s', () => {
  const red = phaseBudgetForMove({
    remainingMs: 60_000,
    incrementMs: 1_000,
    ceilingMs: CEIL,
    ply: 0,
  });
  assert.equal(red.computeBudgetMs, PHASE_TIME.firstPlyMs);
  const black = phaseBudgetForMove({
    remainingMs: 60_000,
    incrementMs: 1_000,
    ceilingMs: CEIL,
    ply: 1,
  });
  // A full share: (58 s / 29.75 + 0.8 s) × 1.0 ≈ 2.75 s.
  assert.ok(black.computeBudgetMs > 2_500, `${black.computeBudgetMs}`);
  const redSecond = phaseBudgetForMove({
    remainingMs: 60_000,
    incrementMs: 1_000,
    ceilingMs: CEIL,
    ply: 2,
  });
  assert.ok(redSecond.computeBudgetMs > black.computeBudgetMs);
});

test('1+1 curve: the most time at bot moves 2-20, less late', () => {
  const run = simulate(phaseAllocator(1_000), ONE_PLUS_ONE, 60, () => 100);
  const mean = (from: number, to: number) => {
    const slice = run.budgets.slice(from - 1, to);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  const flat = simulate(
    (remainingMs) =>
      budgetForMove({ remainingMs, incrementMs: 1_000, ceilingMs: CEIL }).computeBudgetMs,
    ONE_PLUS_ONE,
    60,
    () => 100,
  );
  const flatMean = (from: number, to: number) => {
    const slice = flat.budgets.slice(from - 1, to);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  // Red's first move is quick; flat spends ~2.7 s on it.
  assert.equal(run.budgets[0], PHASE_TIME.firstPlyMs);
  assert.ok(flat.budgets[0]! > 2_600);
  // Moves 2-20 get the most of any phase, and clearly more than flat gives them.
  assert.ok(mean(2, 20) > mean(21, 40));
  assert.ok(mean(21, 40) > mean(41, 60));
  assert.ok(mean(2, 20) > flatMean(2, 20) * 1.2, `${mean(2, 20)} vs ${flatMean(2, 20)}`);
  // It spends the clock it used to leave unspent: lower at move 18 than flat.
  assert.ok(run.clockAt[17]! < flat.clockAt[17]!);
});

for (const [tc, side] of [
  [{ initialMs: 60_000, incrementMs: 1_000 }, 'red'],
  [{ initialMs: 60_000, incrementMs: 1_000 }, 'black'],
  [{ initialMs: 120_000, incrementMs: 1_000 }, 'red'],
  [{ initialMs: 180_000, incrementMs: 2_000 }, 'black'],
] as const) {
  const label = `${tc.initialMs / 60_000}+${tc.incrementMs / 1_000} as ${side}`;

  test(`never flags at ${label}: 150 bot moves, every move overrunning by the full allowance`, () => {
    const run = simulate(
      phaseAllocator(tc.incrementMs, side),
      tc,
      150,
      () => PHASE_TIME.overrunAllowanceMs,
    );
    assert.equal(run.flagged, false);
    assert.ok(
      run.lowestMs >= PHASE_TIME.reserveMs,
      `lowest clock ${run.lowestMs} ms under the ${PHASE_TIME.reserveMs} ms reserve`,
    );
  });

  test(`never flags at ${label}: overrun up to the 1 s watchdog margin`, () => {
    // Past the allowance the reserve absorbs the extra; the clock never runs out.
    const run = simulate(phaseAllocator(tc.incrementMs, side), tc, 150, (m) =>
      m % 3 === 0 ? 1_000 : 500,
    );
    assert.equal(run.flagged, false);
    assert.ok(run.lowestMs > 0);
  });
}

test('planted failure: the simulation catches an allocator without the cap', () => {
  // The phase factors with no never-flag cap: 1.6x a share at a low clock overspends.
  const uncapped: Allocator = (remainingMs, botMove) =>
    Math.max(50, (remainingMs / 18 + 800) * (botMove > 20 ? 1.6 : 1.6));
  const run = simulate(uncapped, ONE_PLUS_ONE, 150, () => PHASE_TIME.overrunAllowanceMs);
  assert.ok(run.flagged || run.lowestMs < PHASE_TIME.reserveMs);
});

test('the cap holds at a clock already near the reserve', () => {
  for (const remainingMs of [100, 1_000, 2_000, 2_500, 3_000, 5_000]) {
    const b = phaseBudgetForMove({ remainingMs, incrementMs: 1_000, ceilingMs: CEIL, ply: 23 });
    assert.ok(b.computeBudgetMs >= 1);
    assert.ok(b.computeBudgetMs <= b.capMs, `${remainingMs}: ${b.computeBudgetMs} > ${b.capMs}`);
    if (remainingMs >= PHASE_TIME.reserveMs) {
      const after = remainingMs - b.computeBudgetMs - PHASE_TIME.overrunAllowanceMs + 1_000;
      assert.ok(after >= PHASE_TIME.reserveMs, `${remainingMs}: leaves ${after}`);
    }
  }
});

test('pace-aware movetime raises to the pace target, never past ceiling or cap', () => {
  assert.equal(
    paceAwareMovetimeMs({ budgetMs: 900, paceTargetMs: 1_400, ceilingMs: 4_000, capMs: 9_000 }),
    1_400,
  );
  assert.equal(
    paceAwareMovetimeMs({ budgetMs: 900, paceTargetMs: 6_000, ceilingMs: 4_000, capMs: 9_000 }),
    4_000,
  );
  assert.equal(
    paceAwareMovetimeMs({ budgetMs: 900, paceTargetMs: 6_000, ceilingMs: 4_000, capMs: 1_200 }),
    1_200,
  );
  // A target under the budget never lowers it.
  assert.equal(
    paceAwareMovetimeMs({ budgetMs: 2_000, paceTargetMs: 1_000, ceilingMs: 4_000, capMs: 9_000 }),
    2_000,
  );
});

const liveBase = {
  engineId: 'pikafish-xiangqi-level-8',
  roomId: 'room-phase-1',
  legalCount: 44,
  initialMs: 60_000,
  incrementMs: 1_000,
  ceilingMs: CEIL,
  flatReserveMs: 1_000,
  floorMs: 50,
  engineVsEngine: false,
};

test('liveBotMoveTime: flat is exactly budgetForMove, whatever the pacing', () => {
  const flat = liveBotMoveTime({
    ...liveBase,
    rule: 'flat',
    ply: 0,
    remainingMs: 60_000,
    pacingEnabled: true,
  });
  const expected = budgetForMove({
    remainingMs: 60_000,
    incrementMs: 1_000,
    ceilingMs: CEIL,
    reserveMs: 1_000,
    floorMs: 50,
  }).computeBudgetMs;
  assert.deepEqual(flat, { movetimeMs: expected, rule: 'flat', budgetMs: expected });
});

test('liveBotMoveTime: a non-top tier stays flat under the phase switch', () => {
  const r = liveBotMoveTime({
    ...liveBase,
    engineId: 'fairy-stockfish-xiangqi-level-5',
    rule: 'phase',
    ply: 20,
    remainingMs: 50_000,
    pacingEnabled: true,
  });
  assert.equal(r.rule, 'flat');
});

test('liveBotMoveTime: the pace hold becomes search time under phase', () => {
  // The game's first move under phase is a quick 150 ms; the paced reply target is
  // higher, so the movetime rises to it instead of sleeping the difference.
  const paced = liveBotMoveTime({
    ...liveBase,
    rule: 'phase',
    ply: 0,
    remainingMs: 60_000,
    pacingEnabled: true,
  });
  const unpaced = liveBotMoveTime({
    ...liveBase,
    rule: 'phase',
    ply: 0,
    remainingMs: 60_000,
    pacingEnabled: false,
  });
  assert.equal(paced.rule, 'phase');
  assert.equal(unpaced.movetimeMs, unpaced.budgetMs);
  assert.equal(paced.budgetMs, unpaced.budgetMs);
  assert.ok(paced.movetimeMs > paced.budgetMs, `${paced.movetimeMs} vs ${paced.budgetMs}`);
  // Engine vs engine has no pace hold, so nothing to fold in.
  const eve = liveBotMoveTime({
    ...liveBase,
    rule: 'phase',
    ply: 0,
    remainingMs: 60_000,
    pacingEnabled: true,
    engineVsEngine: true,
  });
  assert.equal(eve.movetimeMs, eve.budgetMs);
});

test('liveBotMoveTime: some paced turn in a 1+1 game is raised above its budget', () => {
  let raised = 0;
  for (let ply = 0; ply < 80; ply += 2) {
    const r = liveBotMoveTime({
      ...liveBase,
      roomId: 'room-phase-2',
      rule: 'phase',
      ply,
      remainingMs: 40_000,
      pacingEnabled: true,
    });
    assert.ok(r.movetimeMs <= CEIL);
    if (r.movetimeMs > r.budgetMs) raised++;
  }
  assert.ok(raised > 0);
});

test('liveBotMoveTime: a queue wait comes off the clock and the pace target', () => {
  const fresh = liveBotMoveTime({
    ...liveBase,
    rule: 'phase',
    ply: 14,
    remainingMs: 40_000,
    pacingEnabled: false,
  });
  const waited = liveBotMoveTime({
    ...liveBase,
    rule: 'phase',
    ply: 14,
    remainingMs: 40_000,
    waitedMs: 5_000,
    pacingEnabled: false,
  });
  assert.ok(waited.budgetMs < fresh.budgetMs);
});

// --- native: the engine's own time manager on the bot's clock less a reserve ---

test('native applies only to the xiangqi L8 rungs; other top tiers stay flat under it', () => {
  for (const id of NATIVE_TIME_ENGINE_IDS) assert.ok(PHASE_TIME_ENGINE_IDS.has(id));
  const at = (engineId: string) => effectiveTimeRule({ rule: 'native', engineId, ...ONE_PLUS_ONE });
  assert.equal(at('pikafish-xiangqi-level-8'), 'native');
  assert.equal(at('fairy-stockfish-xiangqi-level-8'), 'native');
  assert.equal(at('jqe-jieqi'), 'flat');
  assert.equal(
    nativeRuleApplies({
      rule: 'native',
      engineId: 'pikafish-xiangqi-level-8',
      initialMs: 300_000,
      incrementMs: 5_000,
    }),
    false,
  );
});

test('native: red’s first move is the quick fixed reply, every other move gets a clock', () => {
  const first = nativeClockForMove({ remainingMs: 60_000, incrementMs: 1_000, ply: 0 });
  assert.equal(first.clock, null);
  assert.equal(first.movetimeMs, PHASE_TIME.firstPlyMs);
  const black = nativeClockForMove({ remainingMs: 60_000, incrementMs: 1_000, ply: 1 });
  assert.deepEqual(black.clock, { timeMs: 60_000 - NATIVE_TIME.reserveMs, incMs: 1_000 });
  assert.equal(uciClockWords(black.clock!), 'wtime 57500 btime 57500 winc 1000 binc 1000');
  // The watchdog stays under the real clock.
  assert.ok(black.watchdogTimeoutMs < 60_000);
});

test('liveBotMoveTime: native carries the clock and no pace raise', () => {
  const r = liveBotMoveTime({
    ...liveBase,
    rule: 'native',
    ply: 9,
    remainingMs: 41_000,
    pacingEnabled: true,
  });
  assert.equal(r.rule, 'native');
  assert.deepEqual(r.clock, { timeMs: 41_000 - NATIVE_TIME.reserveMs, incMs: 1_000 });
});

/**
 * A worst-case engine under native: it spends its whole told clock (more than a
 * time manager ever plans) plus `overrunMs`, or is killed at the watchdog.
 */
function simulateNative(
  tc: { initialMs: number; incrementMs: number },
  side: 'red' | 'black',
  overrunMs: number,
  reserveMs: number = NATIVE_TIME.reserveMs,
): { lowestMs: number; flagged: boolean } {
  let clock = tc.initialMs;
  let lowestMs = clock;
  for (let move = 1; move <= 150; move++) {
    const ply = plyOf(move, side);
    const n = nativeClockForMove({ remainingMs: clock, incrementMs: tc.incrementMs, ply });
    const told = n.clock ? clock - reserveMs : n.movetimeMs;
    const watchdog = n.clock ? told + NATIVE_TIME.watchdogGraceMs : n.watchdogTimeoutMs;
    const spent = Math.min(watchdog, told + overrunMs);
    if (spent >= clock) return { lowestMs: clock - spent, flagged: true };
    lowestMs = Math.min(lowestMs, clock - spent);
    clock = clock - spent + tc.incrementMs;
  }
  return { lowestMs, flagged: false };
}

for (const [tc, side] of [
  [{ initialMs: 60_000, incrementMs: 1_000 }, 'red'],
  [{ initialMs: 60_000, incrementMs: 1_000 }, 'black'],
  [{ initialMs: 180_000, incrementMs: 2_000 }, 'black'],
] as const) {
  const label = `${tc.initialMs / 60_000}+${tc.incrementMs / 1_000} as ${side}`;
  test(`native never flags at ${label}: the whole told clock every move, overrun to the watchdog`, () => {
    for (const overrunMs of [0, 500, 1_000, 10_000]) {
      const run = simulateNative(tc, side, overrunMs);
      assert.equal(run.flagged, false, `overrun ${overrunMs}`);
      // Before the increment lands the clock keeps reserve - overrun, floored by the watchdog.
      const floor = NATIVE_TIME.reserveMs - Math.min(overrunMs, NATIVE_TIME.watchdogGraceMs);
      assert.ok(run.lowestMs >= floor, `overrun ${overrunMs}: lowest ${run.lowestMs} < ${floor}`);
    }
  });
}

test('planted failure: native with no reserve flags under the same worst case', () => {
  const run = simulateNative({ initialMs: 60_000, incrementMs: 1_000 }, 'black', 500, 0);
  assert.equal(run.flagged, true);
});

test('native watchdog is the told clock plus the grace', () => {
  assert.equal(
    nativeWatchdogMs({ timeMs: 10_000, incMs: 1_000 }),
    10_000 + NATIVE_TIME.watchdogGraceMs,
  );
});
