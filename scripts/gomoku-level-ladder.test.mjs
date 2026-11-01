import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';
import { baselineMove, playGame, runPairing, seededRandom } from './gomoku-level-ladder.mjs';

const game = await tsImport('../packages/game/src/variants-gomoku.ts', import.meta.url);
const { RAPFI_LEVELS } = await tsImport('../apps/web/src/engine/rapfi.ts', import.meta.url);
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

test('the recorded published budgets agree with RAPFI_LEVELS and a measured pairing', () => {
  const record = JSON.parse(
    readFileSync(new URL('../docs/data/gomoku-level-ladder.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(record.levels, RAPFI_LEVELS);
  for (const tier of record.levels) {
    assert.ok(
      record.runs.some((run) =>
        run.pairings.some((pair) =>
          [pair.weaker, pair.stronger].some(
            (side) =>
              side.level === tier.level && side.nodes === tier.nodes && side.timeMs === tier.timeMs,
          ),
        ),
      ),
      `L${tier.level} has no matching measurement`,
    );
  }
});

test('every recorded game replays to its claimed terminal result in the real kernel', () => {
  const record = JSON.parse(
    readFileSync(new URL('../docs/data/gomoku-level-ladder.json', import.meta.url), 'utf8'),
  );
  for (const run of record.runs) {
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
        assert.deepEqual(
          entry.opening,
          game.GOMOKU_OPENINGS.find((candidate) => candidate.id === entry.opening.id),
        );
        assert.equal(entry.strongerColor, index % 2 ? 'black' : 'white');
        if (index % 2) assert.deepEqual(entry.opening, pair.games[index - 1].opening);
        let state = game.createInitialGomokuState(entry.opening);
        for (const to of entry.moves) {
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
    }
  }
});
