import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAIR_PLAY_SCORE_CAP_CP,
  type FairPlaySummaryGame,
  summarizeFairPlayAccount,
  summarizeFairPlayGame,
} from './fair-play-summary.js';

function fixture(overrides: Partial<FairPlaySummaryGame> = {}): FairPlaySummaryGame {
  return {
    roomId: 'game',
    variant: 'xiangqi',
    timeClass: 'blitz',
    rating: 1700,
    playerColor: 'red',
    endedAt: '2026-11-16T00:00:00.000Z',
    engineId: 'fixture-analysis@1',
    depth: 12,
    moves: Array.from({ length: 14 }, (_, i) => ({
      color: i % 2 ? 'black' : 'red',
      uci: i % 2 ? 'other' : 'best',
      legalMoves: ['best', 'other'],
    })),
    analysis: Array.from({ length: 15 }, (_, ply) => ({
      ply,
      cp: ply % 2 ? 0 : 100,
      mate: null,
      best: 'best',
    })),
    ...overrides,
  };
}

test('known engine lines: account matches every best move, opponents never do', () => {
  const result = summarizeFairPlayGame(fixture());
  assert.deepEqual(result.account.topMoveMatch, { matches: 2, samples: 2, rate: 1 });
  assert.deepEqual(result.opponents.topMoveMatch, { matches: 0, samples: 2, rate: 0 });
  assert.deepEqual(result.account.averageLoss, { totalCp: 0, samples: 2, cp: 0 });
  assert.deepEqual(result.opponents.averageLoss, { totalCp: 200, samples: 2, cp: 100 });
  assert.equal(result.account.skipped.opening, 5);
  assert.equal(result.opponents.skipped.opening, 5);
  const black = summarizeFairPlayGame(fixture({ playerColor: 'black' }));
  assert.deepEqual(black.account, result.opponents);
  assert.deepEqual(black.opponents, result.account);
});

test('the first ten plies, forced moves, and +/-500cp or mate before the move are excluded', () => {
  const game = fixture();
  game.moves = game.moves!.map((move, i) =>
    i === 10 ? { ...move, legalMoves: [move.uci] } : move,
  );
  game.analysis = game.analysis!.map((row) => ({
    ...row,
    ...(row.ply === 11
      ? { cp: 500 }
      : row.ply === 12
        ? { cp: -500 }
        : row.ply === 13
          ? { cp: null, mate: 2 }
          : {}),
  }));
  const result = summarizeFairPlayGame(game);
  assert.equal(result.account.skipped.forced, 1);
  assert.equal(result.account.skipped.decided, 1);
  assert.equal(result.opponents.skipped.decided, 2);
  assert.equal(result.account.topMoveMatch.samples + result.opponents.topMoveMatch.samples, 0);
  assert.equal(result.account.averageLoss.cp, null);
});

test('499cp remains eligible, missing child scores have separate sample counts, unstable rows are unjudged', () => {
  const game = fixture();
  game.analysis = game.analysis!.map((row) => ({
    ...row,
    ...(row.ply === 10
      ? { cp: 499 }
      : row.ply === 11
        ? { cp: null }
        : row.ply === 13
          ? { unstable: true }
          : {}),
  }));
  const result = summarizeFairPlayGame(game);
  assert.equal(result.account.topMoveMatch.samples, 1);
  assert.equal(result.account.averageLoss.samples, 0);
  assert.equal(result.account.skipped.unavailable, 1);
  assert.equal(result.opponents.skipped.unavailable, 2);
});

test('missing/illegal engine bests do not inflate match rates and improvements cannot create negative loss', () => {
  const game = fixture({ playerColor: 'black' });
  game.analysis = game.analysis!.map((row) => ({
    ...row,
    best: 'not-a-legal-move',
    cp: row.ply % 2 ? 100 : 0,
  }));
  const result = summarizeFairPlayGame(game);
  assert.equal(result.account.topMoveMatch.rate, null);
  assert.equal(result.account.topMoveMatch.samples, 0);
  assert.equal(result.account.averageLoss.cp, 0);
});

test('aggregate rates are weighted by move samples and groups carry the account rating', () => {
  const a = fixture();
  const b = fixture({ roomId: 'b', playerColor: 'black' });
  b.moves = b.moves!.slice(0, 12);
  const c = fixture({ roomId: 'c', variant: 'jungle', timeClass: 'correspondence', rating: 1810 });
  const result = summarizeFairPlayAccount('user', [a, b, c]);
  assert.deepEqual(result.account.topMoveMatch, { matches: 4, samples: 5, rate: 0.8 });
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0]!.rating, 1700);
  assert.equal(result.groups[1]!.rating, 1810);
  assert.equal(result.groups[1]!.timeClass, 'correspondence');
});

test('all rating classes group separately, with null for a missing rating', () => {
  const result = summarizeFairPlayAccount(
    'user',
    ['bullet', 'blitz', 'rapid', 'correspondence'].map((timeClass) =>
      fixture({ timeClass: timeClass as FairPlaySummaryGame['timeClass'], rating: null }),
    ),
  );
  assert.equal(result.groups.length, 4);
  assert.ok(result.groups.every((group) => group.rating === null));
});

test('missing analysis is counted/listed; failed replays are evidence gaps', () => {
  const result = summarizeFairPlayAccount('user', [
    fixture({ roomId: 'missing', analysis: null, moves: null, engineId: null, depth: null }),
    fixture({ roomId: 'old-rules', moves: null }),
  ]);
  assert.equal(result.gamesConsidered, 2);
  assert.equal(result.analyzedGames, 1);
  assert.equal(result.missingAnalysisGameCount, 1);
  assert.deepEqual(result.missingAnalysisGames, ['missing']);
  assert.deepEqual(result.unavailableGames, ['old-rules']);
  assert.equal(result.groups[0]!.missingAnalysisGames, 1);
  assert.equal(result.account.topMoveMatch.rate, null);
});

test('empty input reports zero samples and null rates, with no invented rating', () => {
  const result = summarizeFairPlayAccount('user', []);
  assert.equal(result.gamesConsidered, 0);
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.games, []);
  assert.deepEqual(result.missingAnalysisGames, []);
  assert.deepEqual(result.account.topMoveMatch, { matches: 0, samples: 0, rate: null });
  assert.deepEqual(result.opponents.averageLoss, { totalCp: 0, samples: 0, cp: null });
});

test('whole payload contains only summary fields, never stored lines or positions, and leaves input immutable', () => {
  const game = fixture({ variant: 'jieqi' });
  const before = JSON.stringify(game);
  const payload = JSON.stringify(summarizeFairPlayAccount('user', [game]));
  assert.doesNotMatch(payload, /"(?:analysis|moves|legalMoves|best|pv|board|setup|deal|seats)":/);
  assert.equal(JSON.stringify(game), before);
});

test('Gomoku stored scores use Black POV, while fog uses White POV', () => {
  for (const [variant, positive, negative] of [
    ['gomoku', 'black', 'white'],
    ['dark-chess', 'white', 'black'],
  ]) {
    const game = fixture({ variant, playerColor: negative });
    game.moves = game.moves!.map((move, i) => ({ ...move, color: i % 2 ? negative : positive }));
    const result = summarizeFairPlayGame(game);
    assert.equal(result.account.averageLoss.cp, 100);
    assert.equal(result.opponents.averageLoss.cp, 0);
  }
});

test('a move into mate or a huge swing loses at most the capped scale', () => {
  const game = fixture();
  // Red's move 10 walks from +100 into a mate against; Black's move 11 then
  // throws that away for a +5000 red eval; Red's move 12 gets mated again.
  game.analysis = game.analysis!.map((row) => ({
    ...row,
    ...(row.ply === 10
      ? { cp: 100 }
      : row.ply === 11
        ? { cp: null, mate: -3 }
        : row.ply === 12
          ? { cp: 5000 }
          : row.ply === 13
            ? { cp: null, mate: -1 }
            : {}),
  }));
  game.moves = game.moves!.map((move) => ({ ...move, uci: 'other' }));
  const result = summarizeFairPlayGame(game);
  // Ply 10: 100 -> -cap. Plies 11 and 12 start from a mate or >= 500cp: decided.
  assert.deepEqual(result.account.averageLoss, {
    totalCp: 100 + FAIR_PLAY_SCORE_CAP_CP,
    samples: 1,
    cp: 100 + FAIR_PLAY_SCORE_CAP_CP,
  });
  assert.equal(result.account.skipped.decided, 1);
  assert.equal(result.opponents.skipped.decided, 2);
  assert.equal(result.opponents.averageLoss.samples, 0);
});
