import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { tsImport } from 'tsx/esm/api';
import * as ladder from './gomoku-level-ladder.mjs';

const { baselineMove, playGame, runPairing, seededRandom } = ladder;

// The calibration records (18 MB of games) live in the private docs repo, not
// the public tree. GOMOKU_LADDER_DATA points elsewhere; without them the four
// record pins skip by name and the policy tests still run.
const LADDER_DATA = process.env.GOMOKU_LADDER_DATA
  ? new URL(`file://${process.env.GOMOKU_LADDER_DATA.replace(/\/?$/, '/')}`)
  : new URL('../docs-private/gomoku/', import.meta.url);
const LADDER_FILES = ['gomoku-level-ladder.json', 'gomoku-level-ladder-fixed.json'];
const calibrationSkip = LADDER_FILES.every((file) => existsSync(new URL(file, LADDER_DATA)))
  ? false
  : 'calibration records not present (docs-private/gomoku); set GOMOKU_LADDER_DATA to run the pins';
const calibrationRecord = (file) => JSON.parse(readFileSync(new URL(file, LADDER_DATA), 'utf8'));

const game = await tsImport('../packages/game/src/variants-gomoku.ts', import.meta.url);
const rapfi = await tsImport('../apps/web/src/engine/rapfi.ts', import.meta.url);
const { RAPFI_LEVELS } = rapfi;
const opening = {
  turn: 'black',
  stones: [
    ...['d8', 'e8', 'f8', 'g8'].map((square) => ({ square, color: 'black' })),
    ...['c8', 'a1', 'c1', 'e1'].map((square) => ({ square, color: 'white' })),
  ],
};

test('a forced five ends the loop before the other engine is called', async () => {
  const result = await playGame({
    opening,
    black: () => ({ to: 'h8' }),
    white: () => assert.fail('terminal game requested another move'),
  });
  assert.equal(result.winner, 'black');
  assert.equal(result.reason, 'five');
  assert.deepEqual(result.moves, ['h8']);
});

test('illegal engine replies fail loudly instead of becoming losses or draws', async () => {
  for (const reply of [{ to: 'd8' }, { to: 'p1' }, {}, null]) {
    await assert.rejects(
      playGame({ opening, black: () => reply, white: () => ({ to: 'h8' }) }),
      /Illegal.*black.*ply 8/,
    );
  }
});

test('baseline completes its own four and blocks the opponent before choosing randomly', () => {
  const state = game.createInitialGomokuState(opening);
  assert.deepEqual(
    baselineMove(state, () => 0),
    { to: 'h8' },
  );
  assert.deepEqual(
    baselineMove({ ...state, status: { type: 'playing', turn: 'white' } }, () => 0),
    { to: 'h8' },
  );
  const empty = game.createInitialGomokuState();
  assert.deepEqual(
    baselineMove(empty, () => 0),
    { to: 'a1' },
  );
  assert.deepEqual(
    baselineMove(empty, () => 0.999),
    { to: 'o15' },
  );
});

test('paired games reuse exactly the same opening with exchanged colours', async () => {
  const seen = [];
  let resets = 0;
  const result = await runPairing({
    id: 'stub',
    games: 2,
    openings: [opening],
    beforeGame: () => {
      resets += 1;
    },
    weaker: () => {
      seen.push('weaker');
      return { to: 'h8' };
    },
    stronger: () => {
      seen.push('stronger');
      return { to: 'h8' };
    },
  });
  assert.deepEqual(seen, ['weaker', 'stronger']);
  assert.deepEqual(
    result.games.map((entry) => entry.strongerColor),
    ['white', 'black'],
  );
  assert.deepEqual(result.games[0].opening, result.games[1].opening);
  assert.equal(result.strongerWins, 1);
  assert.equal(result.weakerWins, 1);
  assert.equal(result.draws, 0);
  assert.equal(resets, 2);
});

test('seeded sampling is repeatable', () => {
  const a = seededRandom(17);
  const b = seededRandom(17);
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b));
});

test('confidence summary reports wins and half-point scores separately, including draws', () => {
  const pair = {
    id: 'stub',
    games: Array.from({ length: 60 }, (_, index) => ({
      strongerColor: index % 2 ? 'black' : 'white',
      winner: null,
    })),
  };
  const result = ladder.confidenceSummary(pair);
  assert.equal(result.wins, 0);
  assert.equal(result.draws, 60);
  assert.equal(result.losses, 0);
  assert.equal(result.winRate, 0);
  assert.equal(result.scoreRate, 0.5);
  assert.ok(Math.abs(result.wilson95[0]) < 1e-12);
  assert.ok(Math.abs(result.wilson95[1] - 0.060171852142089886) < 1e-12);
  assert.deepEqual(result.pairedBootstrap95, [0, 0]);
  assert.deepEqual(result.scorePairedBootstrap95, [0.5, 0.5]);
});

test('confidence summary resamples both colors together instead of treating 60 games as independent', () => {
  const pair = {
    id: 'stub',
    games: Array.from({ length: 60 }, (_, index) => ({
      strongerColor: index % 2 ? 'black' : 'white',
      winner: index < 30 ? (index % 2 ? 'black' : 'white') : index % 2 ? 'white' : 'black',
    })),
  };
  const result = ladder.confidenceSummary(pair);
  assert.equal(result.winRate, 0.5);
  assert.equal(result.scoreRate, 0.5);
  assert.ok(Math.abs(result.wilson95[0] - 0.37735024241544235) < 1e-12);
  assert.ok(Math.abs(result.wilson95[1] - 0.6226497575845577) < 1e-12);
  assert.deepEqual(result.pairedBootstrap95, [1 / 3, 2 / 3]);
  assert.deepEqual(result.scorePairedBootstrap95, result.pairedBootstrap95);
  assert.deepEqual(ladder.confidenceSummary(pair), result);
  for (const games of [[], pair.games.slice(0, 3)])
    assert.throws(() => ladder.confidenceSummary({ ...pair, games }), /paired/i);
});

test('default pairings cover every active level against baseline and the level two below', () => {
  for (const count of [5, 8]) {
    const levels = Array.from({ length: count }, (_, index) => ({
      level: index + 1,
      nodes: 100 * (index + 1),
      timeMs: 1000,
    }));
    const plan = ladder.pairingPlan(levels);
    assert.deepEqual(
      plan.map(({ id }) => id),
      [
        ...levels.map(({ level }) => `baseline-${level}`),
        ...levels.slice(2).map(({ level }) => `${level - 2}-${level}`),
      ],
    );
    for (const pair of plan) {
      assert.deepEqual(
        pair.stronger,
        levels.find(({ level }) => level === pair.stronger.level),
      );
      if (pair.weaker.level !== 'baseline')
        assert.equal(pair.stronger.level - pair.weaker.level, 2);
    }
    assert.deepEqual(
      ladder.pairingPlan(levels, 'baseline,1-2').map(({ id }) => id),
      ['baseline', '1-2'],
    );
    for (const invalid of [
      'baseline-0',
      `baseline-${count + 1}`,
      '2-1',
      '1-1',
      '1-2,1-2',
      'garbage',
    ])
      assert.throws(() => ladder.pairingPlan(levels, invalid), /pairing/i);
  }
});

test('paired games record reproducible, distinct game seeds and supply the ply seed to players', async () => {
  async function sample(seed, id = 'baseline-1') {
    const seen = [];
    const player = (state, context) => {
      seen.push(context);
      assert.equal(context.plySeed, rapfi.rapfiPlySeed(context.gameSeed, state.ply));
      return { to: 'h8' };
    };
    const result = await runPairing({
      id,
      seed,
      games: 2,
      openings: [opening],
      weaker: player,
      stronger: player,
    });
    assert.deepEqual(
      seen.map(({ gameSeed }) => gameSeed),
      result.games.map(({ seed }) => seed),
    );
    assert.notEqual(result.games[0].seed, result.games[1].seed);
    assert.deepEqual(
      result.games.map(({ seed }) => seed),
      [rapfi.rapfiGameSeed(`${id}:0`, seed), rapfi.rapfiGameSeed(`${id}:1`, seed)],
    );
    return seen;
  }
  assert.deepEqual(await sample(17), await sample(17));
  assert.notDeepEqual(await sample(17), await sample(18));
  assert.notDeepEqual(await sample(17), await sample(17, 'baseline-2'));
});

test('one game derives a fresh seed at every absolute ply, including opening stones', async () => {
  const seen = [];
  const player = (state, context) => {
    seen.push({ ply: state.ply, ...context });
    return { to: state.ply === 8 ? 'o15' : state.ply === 9 ? 'o14' : 'h8' };
  };
  await playGame({ opening, seed: 17, black: player, white: player });
  assert.deepEqual(
    seen.map(({ ply }) => ply),
    [8, 9, 10],
  );
  assert.deepEqual(
    seen.map(({ gameSeed }) => gameSeed),
    [17, 17, 17],
  );
  assert.deepEqual(
    seen.map(({ plySeed }) => plySeed),
    [8, 9, 10].map((ply) => rapfi.rapfiPlySeed(17, ply)),
  );
  assert.equal(new Set(seen.map(({ plySeed }) => plySeed)).size, 3);
});

// Structured INFO blocks with a deliberately conflicting human summary/final
// reply. Selection must consume the shared parser, never the MESSAGE score.
const candidateOutput = [100, 80, -1000]
  .flatMap((ev, pvIndex) => [
    `INFO PV ${pvIndex}`,
    'INFO NUMPV 3',
    'INFO DEPTH 6',
    'INFO SELDEPTH 8',
    'INFO NODES 100',
    'INFO TOTALNODES 300',
    'INFO TOTALTIME 5',
    'INFO SPEED 60000',
    `INFO EVAL ${ev}`,
    'INFO WINRATE 0.5',
    `INFO BESTLINE ${pvIndex},0`,
    'INFO PV DONE',
  ])
  .concat('MESSAGE +29999 | 1-1 | C1', '2,0');

test('ladder uses the shared multi-PV policy and varies choice by game and ply', async () => {
  const commands = [];
  const tier = { ...RAPFI_LEVELS[0], candidateCount: 3, evalMargin: 100 };
  const player = ladder.createRapfiPlayer(tier, async (message, timeout) => {
    commands.push(message.commands);
    assert.equal(timeout, tier.timeMs + 250);
    return { lines: candidateOutput, elapsedMs: 5 };
  });
  const state = game.createInitialGomokuState({
    turn: 'black',
    stones: [
      { square: 'h8', color: 'black' },
      { square: 'o15', color: 'white' },
    ],
  });
  const candidates = rapfi.parseRapfiOutput(candidateOutput);
  const chosen = new Set();
  for (const color of ['black', 'white']) {
    for (let ply = 0; ply < 20; ply++) {
      const context = { gameSeed: 17, plySeed: rapfi.rapfiPlySeed(17, ply) };
      const move = await player.choose(
        { ...state, status: { type: 'playing', turn: color } },
        context,
      );
      const expected = rapfi.selectRapfiMove(
        {
          turn: color === 'black' ? 1 : 2,
          stones: [
            { x: 7, y: 7, player: 1 },
            { x: 14, y: 14, player: 2 },
          ],
        },
        candidates,
        { ...tier, seed: context.plySeed },
      );
      assert.deepEqual(move, { to: `${String.fromCharCode(97 + expected.x)}${expected.y + 1}` });
      assert.notEqual(move.to, 'c1', 'move outside the evaluation margin');
      chosen.add(move.to);
    }
  }
  assert.equal(chosen.size, 2);
  assert.ok(
    commands.every((lines) => lines.includes('INFO show_detail 2') && lines.at(-1) === 'YXNBEST 3'),
  );
  const { moves, ...totals } = player.telemetry;
  assert.equal(moves.length, 40);
  assert.deepEqual(totals, {
    searches: 40,
    wallTimeMs: 200,
    maxMoveMs: 5,
    ceilingHits: 0,
  });
  for (const policy of [
    { candidateCount: 1, evalMargin: 100 },
    { candidateCount: 3, evalMargin: 0 },
  ]) {
    const best = ladder.createRapfiPlayer({ ...tier, ...policy }, async () => ({
      lines: candidateOutput,
      elapsedMs: 1,
    }));
    assert.deepEqual(await best.choose(state, { plySeed: 0 }), { to: 'a1' });
  }
});

test('best-move measurement records completed nodes and final rounded nodes without changing BOARD search', async () => {
  const summary = 'MESSAGE Speed 142K | Depth 14-21 | Eval -466 | Node 80K | Time 563ms';
  const player = ladder.createRapfiPlayer(RAPFI_LEVELS[4], async ({ commands }) => {
    assert.ok(commands.includes('INFO show_detail 2'));
    assert.ok(commands.at(-1).startsWith('BOARD\n'));
    assert.ok(!commands.some((line) => line.startsWith('YXNBEST')));
    return {
      lines: [
        'MESSAGE OptiTime 1477ms | MaxTime 1970ms',
        ...candidateOutput.slice(0, 14),
        summary,
        '7,7',
      ],
      elapsedMs: 640,
    };
  });
  await player.choose(game.createInitialGomokuState(opening), { gameSeed: 17, plySeed: 42 });
  assert.deepEqual(player.telemetry.moves, [
    {
      gameSeed: 17,
      plySeed: 42,
      ply: 8,
      color: 'black',
      to: 'h8',
      elapsedMs: 640,
      completedDepth: 6,
      completedNodes: 300,
      depth: 14,
      seldepth: 21,
      reportedNodes: 80000,
      nodeResolution: 1000,
      engineTimeMs: 563,
      optimalTimeMs: 1477,
      maxTimeMs: 1970,
      summary,
    },
  ]);
});

test('forced replies retain missing search evidence as null rather than invented zero nodes', async () => {
  const player = ladder.createRapfiPlayer(RAPFI_LEVELS[7], async () => ({
    lines: ['7,7'],
    elapsedMs: 1,
  }));
  await player.choose(game.createInitialGomokuState(), { gameSeed: 17, plySeed: 42 });
  const [move] = player.telemetry.moves;
  for (const field of [
    'completedDepth',
    'completedNodes',
    'depth',
    'seldepth',
    'reportedNodes',
    'nodeResolution',
    'engineTimeMs',
    'optimalTimeMs',
    'maxTimeMs',
    'summary',
  ])
    assert.equal(move[field], null, field);
});

test('ladder selection protects a five and an open-four block even without INFO candidates', async () => {
  const player = ladder.createRapfiPlayer(
    { ...RAPFI_LEVELS[0], candidateCount: 4, evalMargin: 500 },
    async () => ({ lines: ['14,14'], elapsedMs: 1 }),
  );
  const win = game.createInitialGomokuState(opening);
  assert.deepEqual(await player.choose(win, { plySeed: 42 }), { to: 'h8' });
  const openFour = {
    ...win,
    board: win.board.map((color, index) => (index === 7 * 15 + 2 ? null : color)),
    status: { type: 'playing', turn: 'white' },
  };
  assert.ok(['c8', 'h8'].includes((await player.choose(openFour, { plySeed: 42 })).to));
});

test('best-move tiers still use BOARD and validate the final reply', async () => {
  const state = game.createInitialGomokuState(opening);
  const player = ladder.createRapfiPlayer(RAPFI_LEVELS[4], async ({ commands }) => {
    assert.ok(commands.some((line) => line.startsWith('BOARD\n')));
    assert.ok(!commands.some((line) => line.startsWith('YXNBEST')));
    return { lines: ['7,7'], elapsedMs: 2 };
  });
  assert.deepEqual(await player.choose(state, { plySeed: 42 }), { to: 'h8' });
  for (const reply of ['3,7', '15,0', 'MESSAGE no move']) {
    const bad = ladder.createRapfiPlayer(RAPFI_LEVELS[4], async () => ({
      lines: [reply],
      elapsedMs: 1,
    }));
    await assert.rejects(bad.choose(state, { plySeed: 42 }), /invalid move/i);
  }
});

test('missing candidates and protocol/watchdog errors abort randomized measurement', async () => {
  const tier = { ...RAPFI_LEVELS[0], candidateCount: 3, evalMargin: 100 };
  for (const [lines, elapsedMs, error] of [
    [['6,7'], 1, /no legal candidates/],
    [['ERROR bad position'], 1, /ERROR bad position/],
    [candidateOutput, tier.timeMs + 251, /watchdog/],
    [candidateOutput, Number.NaN, /elapsed/i],
    [['14,15'], 1, /invalid move/i],
    [candidateOutput.slice(0, -1), 1, /invalid move/i],
  ]) {
    const player = ladder.createRapfiPlayer(tier, async () => ({ lines, elapsedMs }));
    const nonempty = game.createInitialGomokuState({
      turn: 'white',
      stones: [{ square: 'h8', color: 'black' }],
    });
    await assert.rejects(player.choose(nonempty, { plySeed: 0 }), error);
  }
});

test('checkpointing a new policy preserves historical runs, even with the same timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gomoku-ladder-'));
  try {
    const path = join(dir, 'record.json');
    const historical = { startedAt: 'same-time', levels: RAPFI_LEVELS, pairings: [] };
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, levels: RAPFI_LEVELS, runs: [historical] }),
    );
    const levels = RAPFI_LEVELS.map((tier) => ({ ...tier, candidateCount: 3, evalMargin: 100 }));
    const run = { runId: 'new', startedAt: 'same-time', levels, pairings: [{ id: 'baseline-1' }] };
    ladder.writeRun(path, run, levels);
    ladder.writeRun(path, { ...run, pairings: [...run.pairings, { id: '1-3' }] }, levels);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(record.schemaVersion, 1);
    assert.deepEqual(record.levels, levels);
    assert.equal(record.runs.length, 2);
    assert.deepEqual(record.runs[0], historical);
    assert.equal(record.runs[1].pairings.length, 2);
    assert.deepEqual(record.runs[1].levels, levels);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function assertMeasuredPolicies(record, levels) {
  assert.deepEqual(record.levels, levels);
  for (const tier of levels) {
    assert.ok(
      record.runs.some((run) =>
        run.pairings.some((pair) =>
          [pair.weaker, pair.stronger].some((side) => isDeepStrictEqual(side, tier)),
        ),
      ),
      `L${tier.level} has no matching complete-policy measurement`,
    );
  }
}

test('measurement pin rejects candidate-count or margin drift with identical budgets', () => {
  const tier = { ...RAPFI_LEVELS[0], candidateCount: 3, evalMargin: 100 };
  for (const drift of [{ candidateCount: 4 }, { evalMargin: 101 }, { seed: 17 }]) {
    assert.throws(
      () =>
        assertMeasuredPolicies(
          {
            levels: [tier],
            runs: [
              { pairings: [{ weaker: { level: 'baseline' }, stronger: { ...tier, ...drift } }] },
            ],
          },
          [tier],
        ),
      /complete-policy/,
    );
  }
  assertMeasuredPolicies(
    { levels: [tier], runs: [{ pairings: [{ weaker: { level: 'baseline' }, stronger: tier }] }] },
    [tier],
  );
});

test('the recorded complete policy agrees with RAPFI_LEVELS and a measured pairing', {
  skip: calibrationSkip,
}, () => {
  const record = calibrationRecord('gomoku-level-ladder.json');
  assertMeasuredPolicies(record, RAPFI_LEVELS);
});

test('every recorded game replays to its claimed terminal result in the real kernel', {
  skip: calibrationSkip,
}, () => {
  const records = LADDER_FILES.map(calibrationRecord);
  for (const run of records.flatMap((record) => record.runs)) {
    for (const pair of run.pairings) {
      assert.equal(pair.games.length, run.gamesPerPair);
      for (const side of [pair.weaker, pair.stronger]) {
        if (side.level !== 'baseline')
          assert.deepEqual(
            side,
            run.levels.find((tier) => tier.level === side.level),
          );
      }
      const tally = { strongerWins: 0, weakerWins: 0, draws: 0 };
      for (const [index, entry] of pair.games.entries()) {
        // Budget-only historical records predate game seeds and stay valid.
        if (run.seedPolicy)
          assert.equal(entry.seed, rapfi.rapfiGameSeed(`${pair.id}:${index}`, run.seed));
        assert.deepEqual(
          entry.opening,
          game.GOMOKU_OPENINGS.find((candidate) => candidate.id === entry.opening.id),
        );
        assert.equal(entry.strongerColor, index % 2 ? 'black' : 'white');
        if (index % 2) assert.deepEqual(entry.opening, pair.games[index - 1].opening);
        let state = game.createInitialGomokuState(entry.opening);
        for (const to of entry.moves) {
          if (run.telemetryPolicy) {
            const side = state.status.turn === entry.strongerColor ? 'stronger' : 'weaker';
            if (pair[side].level !== 'baseline') {
              const measured = pair.telemetry[side].moves.find(
                (move) => move.gameSeed === entry.seed && move.ply === state.ply,
              );
              assert.ok(measured, `missing search evidence for ${pair.id}/${index}/${state.ply}`);
              assert.equal(measured.to, to);
              assert.equal(measured.color, state.status.turn);
              assert.equal(measured.plySeed, rapfi.rapfiPlySeed(entry.seed, state.ply));
              assert.ok(measured.elapsedMs <= pair[side].timeMs + 250);
              if (measured.completedNodes !== null && measured.reportedNodes !== null)
                assert.ok(
                  measured.completedNodes <= measured.reportedNodes + measured.nodeResolution,
                );
            }
          }
          const next = game.applyGomokuMove(state, { to });
          assert.notEqual(next, state, `illegal recorded move ${to}`);
          state = next;
        }
        assert.deepEqual(state.status, {
          type: 'finished',
          winner: entry.winner,
          reason: entry.reason,
        });
        assert.equal(state.ply, entry.finalPly);
        if (entry.winner === null) tally.draws += 1;
        else if (entry.winner === entry.strongerColor) tally.strongerWins += 1;
        else tally.weakerWins += 1;
      }
      for (const [key, count] of Object.entries(tally)) assert.equal(pair[key], count);
      assert.equal(pair.strongerScore, (pair.strongerWins + pair.draws / 2) / pair.games.length);
      if (run.telemetryPolicy) {
        for (const side of ['weaker', 'stronger']) {
          if (pair[side].level === 'baseline') continue;
          const telemetry = pair.telemetry[side];
          assert.equal(telemetry.searches, telemetry.moves.length);
          const counted = pair.games.reduce((count, entry) => {
            // Count from the kernel rather than assuming the opening's turn.
            let state = game.createInitialGomokuState(entry.opening);
            for (const to of entry.moves) {
              const actualSide = state.status.turn === entry.strongerColor ? 'stronger' : 'weaker';
              if (side === actualSide) count += 1;
              state = game.applyGomokuMove(state, { to });
            }
            return count;
          }, 0);
          assert.equal(telemetry.moves.length, counted);
        }
      }
    }
  }
});

test('fixed BOARD calibration is a separate full attempt plus 60 games per top pairing on the original seeds', {
  skip: calibrationSkip,
}, () => {
  const original = calibrationRecord('gomoku-level-ladder.json');
  const fixed = calibrationRecord('gomoku-level-ladder-fixed.json');
  const [full, ...top] = fixed.runs;
  assert.equal(fixed.runs.length, 3);
  assertMeasuredPolicies(fixed, RAPFI_LEVELS);
  assert.equal(full.label, 'fixed-board-full');
  assert.equal(full.gamesPerPair, 20);
  assert.deepEqual(
    full.pairings.map((pair) => pair.id),
    ladder.pairingPlan().map((pair) => pair.id),
  );
  for (const run of top) {
    assert.ok(run.label.startsWith('fixed-board-top60-'));
    assert.equal(run.gamesPerPair, 60);
  }
  assert.deepEqual(
    fixed.analysis.topPairings,
    top.flatMap((run) => run.pairings.map((pair) => ladder.confidenceSummary(pair, run.seed))),
  );
  assert.deepEqual(
    top.flatMap((run) => run.pairings.map((pair) => pair.id)),
    ['5-7', '6-8'],
  );
  for (const run of fixed.runs) {
    assert.equal(run.seed, 20261101);
    assert.deepEqual(run.levels, RAPFI_LEVELS);
    assert.deepEqual(run.engine, original.runs.at(-1).engine);
    assert.equal(run.openingsSha256, original.runs.at(-1).openingsSha256);
    assert.match(run.boardPolicy, /ebb6b3637/);
    assert.equal(
      run.pairings.reduce((n, pair) => n + pair.games.length, 0),
      run.gamesPerPair * run.pairings.length,
    );
    for (const pair of run.pairings) {
      const prior = original.runs
        .find((r) => r.label === 'eight-level-initial')
        .pairings.find((p) => p.id === pair.id);
      for (const [index, entry] of pair.games.slice(0, 20).entries()) {
        assert.deepEqual(entry.opening, prior.games[index].opening);
        assert.equal(entry.seed, prior.games[index].seed);
      }
    }
  }
});

test('eight-level calibration measures every active pairing, preserving history with at most one affected-pair rerun', {
  skip: calibrationSkip,
}, () => {
  const record = calibrationRecord('gomoku-level-ladder.json');
  const runs = record.runs.filter((run) => run.label.startsWith('eight-level-'));
  assert.ok(runs.length >= 1 && runs.length <= 2);
  const run = runs.at(-1);
  assert.deepEqual(run.levels, RAPFI_LEVELS);
  const activePlan = ladder.pairingPlan(RAPFI_LEVELS);
  for (const pair of activePlan) {
    assert.ok(
      runs.some((attempt) =>
        attempt.pairings.some(
          (measured) =>
            measured.id === pair.id &&
            isDeepStrictEqual(measured.weaker, pair.weaker) &&
            isDeepStrictEqual(measured.stronger, pair.stronger),
        ),
      ),
      `active ${pair.id} has no matching complete-policy measurement`,
    );
  }
  for (const [index, attempt] of runs.entries()) {
    assert.equal(attempt.gamesPerPair, 20);
    const changed = index
      ? attempt.levels
          .filter(
            (tier) =>
              !isDeepStrictEqual(
                tier,
                runs[0].levels.find((old) => old.level === tier.level),
              ),
          )
          .map((tier) => tier.level)
      : [];
    const plan = ladder
      .pairingPlan(attempt.levels)
      .filter(
        (pair) =>
          !index || changed.includes(pair.weaker.level) || changed.includes(pair.stronger.level),
      );
    assert.deepEqual(
      attempt.pairings.map(({ id }) => id),
      plan.map(({ id }) => id),
    );
    assert.equal(attempt.seed, 20261101);
    for (const pair of attempt.pairings) {
      assert.equal(pair.games.length, 20);
      assert.ok(pair.games.every((entry) => Number.isInteger(entry.seed)));
      if (pair.stronger.level === 8) assert.ok(pair.telemetry.stronger.maxMoveMs <= 5000);
    }
  }
  // Budget-only history stays intact alongside the randomized calibration.
  assert.deepEqual(
    record.runs.slice(0, 2).map((run) => run.pairings.map((pair) => pair.strongerWins)),
    [
      [20, 9, 10, 8, 10],
      [18, 20, 12, 10, 8],
    ],
  );
});

test('empty-board tier requests use the same plain centre reply as the browser', async () => {
  for (const tier of RAPFI_LEVELS.slice(0, 4)) {
    const player = ladder.createRapfiPlayer(tier, async ({ commands }) => {
      assert.equal(commands.at(-1), 'BEGIN');
      assert.ok(!commands.includes('INFO show_detail 2'));
      return { lines: ['7,7'], elapsedMs: 1 };
    });
    assert.deepEqual(await player.choose(game.createInitialGomokuState(), { plySeed: 42 }), {
      to: 'h8',
    });
  }
});
