import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleMinedXiangqiPuzzle,
  assertXiangqiSolverGateVersion,
  buildXiangqiSolutionFromPv,
  classifyXiangqiSolverMoveUniqueness,
  createInitialXiangqiState,
  detectXiangqiBlunderCandidates,
  getStandardXiangqiLegalMoves,
  isXiangqiQuietKeyMove,
  isXiangqiSolverMoveUnique,
  makeXiangqiPuzzleInitial,
  tagXiangqiPuzzleThemes,
  validateStandardXiangqiPuzzle,
  XIANGQI_MATE_SCORE_CP,
  XIANGQI_SOLVER_GATE_DEFAULTS,
  XIANGQI_SOLVER_GATE_VERSION,
  type XiangqiBoard,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiPuzzleAttributionIssue,
  xiangqiPuzzleHasStartingChoice,
  xiangqiPuzzleTitle,
  xiangqiSourceAttribution,
  xiangqiUciScoreToCp,
  xiangqiWinRate,
} from './index.js';

function playingState(
  id: string,
  board: XiangqiBoard,
  turn: 'red' | 'black' = 'red',
): XiangqiGameState {
  return {
    id,
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
}

// Red mates in two: b1-b9 checks along rank 9 (a8 covers e8, so e10 is black's
// only reply), then a8-a10 mates along rank 10 (b9 covers the e9 flight).
function mateInTwoState(): XiangqiGameState {
  return playingState('mining-mate-in-2', {
    d1: { color: 'red', role: 'general' },
    a8: { color: 'red', role: 'chariot' },
    b1: { color: 'red', role: 'chariot' },
    e9: { color: 'black', role: 'general' },
  });
}

const MATE_IN_TWO_PV = [
  { from: 'b1', to: 'b9' },
  { from: 'e9', to: 'e10' },
  { from: 'a8', to: 'a10' },
] as const;

// ── UCI score normalization ─────────────────────────────────────────────────

test('xiangqiUciScoreToCp maps cp, mate, mate 0, and malformed scores', () => {
  assert.equal(xiangqiUciScoreToCp({ cp: 123, mate: null }), 123);
  assert.equal(xiangqiUciScoreToCp({ cp: -450, mate: null }), -450);
  // Mate FOR the side to move: closer mates score higher.
  assert.equal(xiangqiUciScoreToCp({ cp: null, mate: 3 }), XIANGQI_MATE_SCORE_CP - 3);
  assert.ok(
    xiangqiUciScoreToCp({ cp: null, mate: 1 })! > xiangqiUciScoreToCp({ cp: null, mate: 5 })!,
  );
  // Mate AGAINST the side to move.
  assert.equal(xiangqiUciScoreToCp({ cp: null, mate: -2 }), -(XIANGQI_MATE_SCORE_CP - 2));
  // mate 0 = already mated.
  assert.equal(xiangqiUciScoreToCp({ cp: null, mate: 0 }), -XIANGQI_MATE_SCORE_CP);
  assert.equal(xiangqiUciScoreToCp({ cp: null, mate: null }), null);
});

// ── Blunder detection ────────────────────────────────────────────────────────

const DETECT_OPTS = { minPly: 0, swingCp: 250, winCp: 250, decidedCp: 800 };

test('detectXiangqiBlunderCandidates flags the move whose reply eval jumps for the opponent', () => {
  // scans[i] = best cp at the position BEFORE move i, mover POV. Move 3 is the
  // blunder: mover stood at -20, but after the move the opponent's best is
  // +320, i.e. the move was worth -320 to the mover (a 300cp swing).
  const scans = [10, -12, 15, -20, 320, -40, 30];
  const candidates = detectXiangqiBlunderCandidates(scans, 6, DETECT_OPTS);
  assert.deepEqual(candidates, [{ ply: 3, preBestCp: -20, postBestCp: 320, swingCp: 300 }]);
});

test('detectXiangqiBlunderCandidates respects minPly', () => {
  const scans = [10, -12, 15, -20, 320, -40, 30];
  assert.deepEqual(detectXiangqiBlunderCandidates(scans, 6, { ...DETECT_OPTS, minPly: 4 }), []);
});

test('detectXiangqiBlunderCandidates skips already-decided positions', () => {
  // Same swing shape, but the mover was already lost (-900) before the move.
  const scans = [10, -12, 15, -900, 1200, -40, 30];
  assert.deepEqual(detectXiangqiBlunderCandidates(scans, 6, DETECT_OPTS), []);
});

test('detectXiangqiBlunderCandidates requires the solver to be winning after the move', () => {
  // A 300cp swing that only reaches +200 for the opponent is not a puzzle.
  const scans = [10, -12, 15, -100, 200, -40, 30];
  assert.deepEqual(detectXiangqiBlunderCandidates(scans, 6, DETECT_OPTS), []);
});

test('detectXiangqiBlunderCandidates skips unscanned (null) positions', () => {
  const scans = [10, -12, 15, null, 320, -40, 30];
  assert.deepEqual(detectXiangqiBlunderCandidates(scans, 6, DETECT_OPTS), []);
});

test('detectXiangqiBlunderCandidates treats mate-mapped scores as decisive', () => {
  // The mover blunders into a forced mate: post eval is a mate score.
  const mateCp = XIANGQI_MATE_SCORE_CP - 2;
  const scans = [10, -12, 15, -20, mateCp, null, null];
  const candidates = detectXiangqiBlunderCandidates(scans, 6, DETECT_OPTS);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.ply, 3);
  assert.equal(candidates[0]?.postBestCp, mateCp);
});

// ── Uniqueness rule ──────────────────────────────────────────────────────────

const SOLVER_UNIQUE_OPTS = XIANGQI_SOLVER_GATE_DEFAULTS;
const cp = (scoreCp: number) => ({ scoreCp, mate: null });
const mating = (mate: number) => ({ scoreCp: XIANGQI_MATE_SCORE_CP - mate, mate });
const unique = (
  best: ReturnType<typeof cp> | ReturnType<typeof mating>,
  second?: ReturnType<typeof cp> | ReturnType<typeof mating>,
) => isXiangqiSolverMoveUnique(best, second, SOLVER_UNIQUE_OPTS);

test('solver admission does not inherit the grader immediate-mate exception', () => {
  assert.equal(unique(mating(1), cp(700)), false);
  assert.equal(unique(mating(1), mating(2)), false);
});

test('non-mating answers need meaningful winning-chance separation on the CC0 scale', () => {
  assert.equal(unique(cp(350), cp(0)), false);
  assert.equal(unique(cp(350), cp(-200)), true);
  assert.equal(unique(cp(600), cp(40)), true);
});

test('only legal moves still require a clear win', () => {
  assert.equal(unique(cp(400)), true);
  assert.equal(unique(cp(-400)), false);
  assert.equal(unique(cp(200), cp(-1000)), false);
});

test('the same chance-gap boundary applies to mates and centipawn scores', () => {
  assert.equal(unique(mating(2), cp(132)), true);
  assert.equal(unique(mating(2), cp(134)), false);
  assert.equal(unique(cp(500), cp(50)), true);
  assert.equal(unique(cp(500), cp(60)), false);
  const gap = xiangqiWinRate(500) - xiangqiWinRate(50);
  assert.equal(
    isXiangqiSolverMoveUnique(cp(500), cp(50), { ...SOLVER_UNIQUE_OPTS, minWinRateGap: gap }),
    false,
  );
});

test('multiple overwhelming wins and alternative forced mates fail admission', () => {
  assert.equal(unique(cp(900), cp(600)), false);
  assert.equal(unique(cp(600), cp(550)), false);
  assert.equal(unique(mating(9), cp(1730)), false);
  assert.equal(unique(mating(7), cp(748)), false);
  assert.equal(unique(mating(3), mating(4)), false);
  assert.equal(unique(mating(3), mating(-4)), true);
});

test('mate-in-one admission bounds the strongest non-immediate alternative', () => {
  assert.equal(unique(mating(1), cp(297)), true);
  assert.equal(unique(mating(1), cp(298)), false);
  assert.equal(
    unique(mating(1), mating(1)),
    false,
    'a top-two list cannot rule out a strong third move',
  );
  assert.deepEqual(classifyXiangqiSolverMoveUniqueness(mating(1), mating(1), SOLVER_UNIQUE_OPTS), {
    unique: false,
    reason: 'immediate-mate-alternatives-unchecked',
  });
  const covered = (third: ReturnType<typeof cp>) =>
    isXiangqiSolverMoveUnique(mating(1), mating(1), SOLVER_UNIQUE_OPTS, {
      lines: [mating(1), mating(1), third],
      legalMoveCount: 10,
    });
  assert.equal(covered(cp(0)), true);
  assert.equal(covered(cp(700)), false);
});

test('a list containing only immediate mates needs complete legal-move coverage', () => {
  const lines = [mating(1), mating(1)];
  assert.equal(
    isXiangqiSolverMoveUnique(lines[0], lines[1], SOLVER_UNIQUE_OPTS, { lines, legalMoveCount: 2 }),
    true,
  );
  assert.equal(
    isXiangqiSolverMoveUnique(lines[0], lines[1], SOLVER_UNIQUE_OPTS, { lines, legalMoveCount: 3 }),
    false,
  );
  assert.equal(
    isXiangqiSolverMoveUnique(cp(400), undefined, SOLVER_UNIQUE_OPTS, {
      lines: [cp(400)],
      legalMoveCount: 3,
    }),
    false,
  );
});

test('invalid score or configuration evidence cannot pass a separation gate', () => {
  assert.equal(unique(cp(Number.NaN), cp(-1000)), false);
  assert.throws(() =>
    isXiangqiSolverMoveUnique(cp(500), cp(0), { ...SOLVER_UNIQUE_OPTS, winRateK: Number.NaN }),
  );
});

test('CC0 pilot regressions retain clear tactics and reject competing wins', () => {
  // Pinned CC0 pilot, 5M nodes, 2026-11-09. Scores favor the solver.
  for (const [name, best, second, expected] of [
    ['48gHj root', mating(11), cp(527), false],
    ['48gHj later', mating(7), cp(748), false],
    ['pPdSk', mating(3), mating(4), false],
    ['HCfFJ defence', cp(871), cp(0), true],
    ['HCfFJ tail', cp(582), cp(310), false],
    ['MHTdb capture', cp(438), cp(-340), true],
    ['MHTdb fork choices', cp(456), cp(111), false],
    ['zHNIm', cp(360), cp(-39), true],
    ['YAK1n', cp(352), cp(-197), true],
    ['1Je5x', cp(341), cp(-231), true],
    ['MleJ5', cp(453), cp(-240), true],
  ] as const)
    assert.equal(unique(best, second), expected, name);
});

// ── Solution building ────────────────────────────────────────────────────────

const BUILD_OPTS = { maxSolutionPlies: 7, minSolutionPlies: 3 };

test('buildXiangqiSolutionFromPv replays a mate PV to the terminal state', () => {
  const built = buildXiangqiSolutionFromPv(mateInTwoState(), MATE_IN_TWO_PV, {
    ...BUILD_OPTS,
    mateExpected: true,
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.endedByMate, true);
    assert.equal(built.moves.length, 3);
    assert.deepEqual(built.finalState.status, {
      type: 'finished',
      winner: 'red',
      reason: 'checkmate',
    });
  }
});

test('buildXiangqiSolutionFromPv truncates a non-mate PV to an odd length', () => {
  const initial = createInitialXiangqiState('mining-open');
  const pv: XiangqiMove[] = [
    { from: 'h3', to: 'e3' },
    { from: 'h8', to: 'e8' },
    { from: 'h1', to: 'g3' },
    { from: 'h10', to: 'g8' },
  ];
  const built = buildXiangqiSolutionFromPv(initial, pv, { ...BUILD_OPTS, mateExpected: false });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.endedByMate, false);
    assert.equal(built.moves.length, 3);
    assert.equal(built.finalState.status.type, 'playing');
    if (built.finalState.status.type === 'playing') {
      assert.equal(built.finalState.status.turn, 'black');
    }
  }
});

test('buildXiangqiSolutionFromPv rejects an expected mate that the cap cuts off', () => {
  const built = buildXiangqiSolutionFromPv(mateInTwoState(), MATE_IN_TWO_PV, {
    maxSolutionPlies: 1,
    minSolutionPlies: 1,
    mateExpected: true,
  });
  assert.deepEqual(built, { ok: false, reason: 'mate-not-reached' });
});

test('buildXiangqiSolutionFromPv rejects illegal, empty, and too-short PVs', () => {
  const illegal = buildXiangqiSolutionFromPv(mateInTwoState(), [{ from: 'a8', to: 'b7' }], {
    ...BUILD_OPTS,
    mateExpected: false,
  });
  assert.deepEqual(illegal, { ok: false, reason: 'pv-illegal' });

  const empty = buildXiangqiSolutionFromPv(mateInTwoState(), [], {
    ...BUILD_OPTS,
    mateExpected: false,
  });
  assert.deepEqual(empty, { ok: false, reason: 'pv-empty' });

  const short = buildXiangqiSolutionFromPv(
    createInitialXiangqiState('mining-short'),
    [
      { from: 'h3', to: 'e3' },
      { from: 'h8', to: 'e8' },
    ],
    { ...BUILD_OPTS, mateExpected: false },
  );
  assert.deepEqual(short, { ok: false, reason: 'too-short' });
});

// ── Puzzle initial state ─────────────────────────────────────────────────────

test('makeXiangqiPuzzleInitial resets clock and repetition history, keeps lastMove', () => {
  const midGame: XiangqiGameState = {
    ...mateInTwoState(),
    progressClock: 17,
    moveNumber: 23,
    lastMove: { from: 'e8', to: 'e9' },
    positionCounts: { stale1: 2, stale2: 1 },
  };
  const initial = makeXiangqiPuzzleInitial(midGame, 'xq-mined-test-1');
  assert.equal(initial.id, 'xq-mined-test-1');
  assert.equal(initial.progressClock, 0);
  assert.equal(initial.moveNumber, 23);
  assert.deepEqual(initial.lastMove, { from: 'e8', to: 'e9' });
  assert.equal(Object.keys(initial.positionCounts).length, 1);
  assert.deepEqual(Object.values(initial.positionCounts), [1]);
});

// ── Themes + title ───────────────────────────────────────────────────────────

test('tagXiangqiPuzzleThemes tags mate depth, capture, swing size, and game phase', () => {
  const initial = mateInTwoState();
  const themes = tagXiangqiPuzzleThemes({
    initial,
    solution: [...MATE_IN_TWO_PV],
    goal: { type: 'checkmate', winner: 'red' },
    swingCp: 700,
  });
  assert.deepEqual(themes, ['checkmate', 'matein2', 'crushing', 'endgame']);

  // A full opening board with a capturing first move: winning-material + middlegame.
  const opening = createInitialXiangqiState('mining-themes');
  const advantage = tagXiangqiPuzzleThemes({
    initial: opening,
    // Not a legal line; theme tagging only inspects the initial board.
    solution: [{ from: 'h3', to: 'h10' }],
    goal: { type: 'winning-advantage', winner: 'red', centipawns: 400 },
    swingCp: 300,
  });
  assert.deepEqual(advantage, ['winning', 'winning-material', 'middlegame']);

  // Seven plies is mate in 4: the miner used to leave these without a length tag.
  const mateInFour = tagXiangqiPuzzleThemes({
    initial,
    // Not a legal line; only its length matters here.
    solution: Array.from({ length: 7 }, () => ({ from: 'a1', to: 'a2' }) as XiangqiMove),
    goal: { type: 'checkmate', winner: 'red' },
    swingCp: 700,
  });
  assert.ok(mateInFour.includes('matein4'));
});

test('xiangqiPuzzleTitle names the side and the goal', () => {
  assert.equal(xiangqiPuzzleTitle('red', { type: 'checkmate' }, 3), 'Red mate in 2');
  assert.equal(xiangqiPuzzleTitle('black', { type: 'checkmate' }, 1), 'Black mate in 1');
  assert.equal(
    xiangqiPuzzleTitle('black', { type: 'winning-advantage', centipawns: 500 }, 3),
    'Black winning advantage',
  );
});

// ── Assembly ─────────────────────────────────────────────────────────────────

test('assembleMinedXiangqiPuzzle builds a validated, source-linked mate puzzle', () => {
  const result = assembleMinedXiangqiPuzzle(
    {
      gameId: 'g1',
      blunderPly: 20,
      postBlunderState: mateInTwoState(),
      pv: [...MATE_IN_TWO_PV],
      verifyScore: { scoreCp: XIANGQI_MATE_SCORE_CP - 2, mate: 2 },
      swingCp: 700,
    },
    BUILD_OPTS,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const puzzle = result.puzzle;
    assert.equal(puzzle.id, 'xq-mined-g1-21');
    assert.equal(puzzle.variant, 'xiangqi');
    assert.equal(puzzle.title, 'Red mate in 2');
    assert.deepEqual(puzzle.goal, { type: 'checkmate', winner: 'red' });
    assert.deepEqual(puzzle.sourceGame, { gameId: 'g1', ply: 21 });
    assert.equal(puzzle.initial.progressClock, 0);
    assert.equal(validateStandardXiangqiPuzzle(puzzle).ok, true);
  }
});

test('assembleMinedXiangqiPuzzle rejects when the expected mate is not reachable', () => {
  const result = assembleMinedXiangqiPuzzle(
    {
      gameId: 'g1',
      blunderPly: 20,
      postBlunderState: mateInTwoState(),
      // The PV stops before the mate the verify score promised.
      pv: [{ from: 'b1', to: 'b9' }],
      verifyScore: { scoreCp: XIANGQI_MATE_SCORE_CP - 2, mate: 2 },
      swingCp: 700,
    },
    BUILD_OPTS,
  );
  assert.deepEqual(result, { ok: false, reason: 'mate-not-reached' });
});

// ── #712 harder mining: quiet key, floor after trim, source attribution ─────

// Red wins a loose horse with a1xa5 and the PV then shuffles: a winning-
// advantage line whose trim cuts it back to the single capture.
function looseHorseState(): XiangqiGameState {
  return playingState('mining-loose-horse', {
    d1: { color: 'red', role: 'general' },
    a1: { color: 'red', role: 'chariot' },
    e10: { color: 'black', role: 'general' },
    a5: { color: 'black', role: 'horse' },
  });
}

const LOOSE_HORSE_PV: XiangqiMove[] = [
  { from: 'a1', to: 'a5' },
  { from: 'e10', to: 'e9' },
  { from: 'a5', to: 'a6' },
  { from: 'e9', to: 'e10' },
  { from: 'a6', to: 'a7' },
];

function looseHorseInput(
  sourceMeta?: Parameters<typeof assembleMinedXiangqiPuzzle>[0]['sourceMeta'],
) {
  return {
    gameId: 'g2',
    blunderPly: 30,
    postBlunderState: looseHorseState(),
    pv: LOOSE_HORSE_PV,
    verifyScore: { scoreCp: 900, mate: null },
    swingCp: 600,
    ...(sourceMeta ? { sourceMeta } : {}),
  };
}

test('quiet PV tails cannot bypass the configured minimum solution length', () => {
  assert.deepEqual(
    assembleMinedXiangqiPuzzle(looseHorseInput(), { maxSolutionPlies: 9, minSolutionPlies: 3 }),
    { ok: false, reason: 'too-short-after-trim' },
  );
});

test('isXiangqiQuietKeyMove: a capture or a check is loud, a developing move is quiet', () => {
  const opening = createInitialXiangqiState('quiet-open');
  assert.equal(isXiangqiQuietKeyMove(opening, { from: 'h3', to: 'e3' }), true);
  assert.equal(isXiangqiQuietKeyMove(looseHorseState(), { from: 'a1', to: 'a5' }), false);
  // b1-b9 checks the general on e9.
  assert.equal(isXiangqiQuietKeyMove(mateInTwoState(), { from: 'b1', to: 'b9' }), false);
});

test('assembleMinedXiangqiPuzzle with quietKey refuses a checking key', () => {
  const input = {
    gameId: 'g1',
    blunderPly: 20,
    postBlunderState: mateInTwoState(),
    pv: [...MATE_IN_TWO_PV],
    verifyScore: { scoreCp: XIANGQI_MATE_SCORE_CP - 2, mate: 2 },
    swingCp: 700,
  };
  assert.equal(assembleMinedXiangqiPuzzle(input, BUILD_OPTS).ok, true);
  assert.deepEqual(assembleMinedXiangqiPuzzle(input, { ...BUILD_OPTS, quietKey: true }), {
    ok: false,
    reason: 'loud-key',
  });
});

test('assembleMinedXiangqiPuzzle always enforces its minimum after trimming', () => {
  const opts = { maxSolutionPlies: 9, minSolutionPlies: 5 };
  assert.deepEqual(assembleMinedXiangqiPuzzle(looseHorseInput(), opts), {
    ok: false,
    reason: 'too-short-after-trim',
  });
  const easy = assembleMinedXiangqiPuzzle(looseHorseInput(), { ...opts, minSolutionPlies: 1 });
  assert.equal(easy.ok, true);
  if (easy.ok) assert.equal(easy.puzzle.solution.length, 1);
  assert.deepEqual(
    assembleMinedXiangqiPuzzle(looseHorseInput(), { ...opts, floorAfterTrim: true }),
    {
      ok: false,
      reason: 'too-short-after-trim',
    },
  );
});

test('assembleMinedXiangqiPuzzle refuses a DPXQ game with no link and credits one with http', () => {
  const opts = { maxSolutionPlies: 9, minSolutionPlies: 1 };
  assert.deepEqual(
    assembleMinedXiangqiPuzzle(looseHorseInput({ sourceSlug: 'dpxq-archive-test' }), opts),
    { ok: false, reason: 'missing-attribution' },
  );
  const linked = assembleMinedXiangqiPuzzle(
    looseHorseInput({
      sourceSlug: 'dpxq-archive-test',
      sourceUrl: 'https://dpxq.com/hldcg/search/view_m_140041.html',
    }),
    opts,
  );
  assert.equal(linked.ok, true);
  if (linked.ok) {
    assert.deepEqual(linked.puzzle.sourceGame?.attribution, {
      name: '东萍象棋网 (DPXQ)',
      url: 'http://www.dpxq.com/hldcg/search/view_m_140041.html',
    });
  }
  // A source with no policy (ElephantChess) needs and gets no credit field.
  const plain = assembleMinedXiangqiPuzzle(
    looseHorseInput({ sourceSlug: 'elephantchess-pvp' }),
    opts,
  );
  assert.equal(plain.ok, true);
  if (plain.ok) assert.equal(plain.puzzle.sourceGame?.attribution, undefined);
});

test('xiangqiSourceAttribution rebuilds the DPXQ link from the view id', () => {
  assert.deepEqual(xiangqiSourceAttribution({ sourceSlug: 'dpxq', sourceGameId: 'view_m_7' }), {
    ok: true,
    attribution: {
      name: '东萍象棋网 (DPXQ)',
      url: 'http://www.dpxq.com/hldcg/search/view_m_7.html',
    },
  });
  assert.deepEqual(
    xiangqiSourceAttribution({ sourceSlug: 'dpxq', sourceUrl: 'https://example.com/x' }),
    {
      ok: false,
      reason: 'missing-attribution',
    },
  );
});

test('xiangqiPuzzleAttributionIssue flags a DPXQ puzzle without an http credit', () => {
  const base = { id: 'p1', sourceGame: { gameId: 'g', ply: 3 } };
  assert.equal(xiangqiPuzzleAttributionIssue(base, 'elephantchess-pvp'), null);
  assert.match(
    xiangqiPuzzleAttributionIssue(base, 'dpxq-archive-test') ?? '',
    /lacks the required source credit/,
  );
  const https = {
    id: 'p1',
    sourceGame: {
      gameId: 'g',
      ply: 3,
      attribution: { name: 'DPXQ', url: 'https://www.dpxq.com/a.html' },
    },
  };
  assert.match(xiangqiPuzzleAttributionIssue(https, 'dpxq') ?? '', /does not accept/);
  const ok = {
    id: 'p1',
    sourceGame: {
      gameId: 'g',
      ply: 3,
      attribution: { name: 'DPXQ', url: 'http://www.dpxq.com/a.html' },
    },
  };
  assert.equal(xiangqiPuzzleAttributionIssue(ok, 'dpxq'), null);
});

// Reported move 25: mate in nine beside +17.3 and +12.8 must not be
// admitted as one forced answer simply because only one PV shows mate.
test('mate beside a decisive centipawn alternative is not unique', () => {
  for (const scoreCp of [1730, 1280, 800]) {
    assert.deepEqual(
      classifyXiangqiSolverMoveUniqueness(
        { scoreCp: XIANGQI_MATE_SCORE_CP - 9, mate: 9 },
        { scoreCp, mate: null },
        SOLVER_UNIQUE_OPTS,
      ),
      { unique: false, reason: 'insufficient-separation' },
    );
  }
  assert.equal(
    isXiangqiSolverMoveUnique(
      { scoreCp: XIANGQI_MATE_SCORE_CP - 9, mate: 9 },
      { scoreCp: 40, mate: null },
      SOLVER_UNIQUE_OPTS,
    ),
    true,
  );
});

test('solver gate evidence has an explicit version and rejects missing or old policy', () => {
  assert.doesNotThrow(() => assertXiangqiSolverGateVersion(XIANGQI_SOLVER_GATE_VERSION));
  for (const version of [undefined, null, '', 'only-mate-v1', 'unique-winning-move-v2']) {
    assert.throws(() => assertXiangqiSolverGateVersion(version), /requires solver gate/);
  }
});

test('mining rejects a forced start independently of a supplied winning score', () => {
  const forced = playingState('forced-root', {
    e1: { color: 'red', role: 'general' },
    a3: { color: 'red', role: 'chariot' },
    d10: { color: 'black', role: 'general' },
    e3: { color: 'black', role: 'chariot' },
    d2: { color: 'black', role: 'chariot' },
    h2: { color: 'black', role: 'horse' },
  });
  assert.deepEqual(getStandardXiangqiLegalMoves(forced), [{ from: 'a3', to: 'e3' }]);
  assert.equal(xiangqiPuzzleHasStartingChoice(forced), false);
  assert.equal(xiangqiPuzzleHasStartingChoice(mateInTwoState()), true);
  const result = assembleMinedXiangqiPuzzle(
    {
      gameId: 'forced-root',
      blunderPly: 20,
      postBlunderState: forced,
      pv: [{ from: 'a3', to: 'e3' }],
      verifyScore: { scoreCp: 600, mate: null },
      swingCp: 700,
    },
    { ...BUILD_OPTS, minSolutionPlies: 1 },
  );
  assert.deepEqual(result, { ok: false, reason: 'no-choice-at-root' });
});
