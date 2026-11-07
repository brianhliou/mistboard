import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleMinedXiangqiPuzzle,
  buildXiangqiSolutionFromPv,
  classifyXiangqiSolverMoveUniqueness,
  createInitialXiangqiState,
  detectXiangqiBlunderCandidates,
  isXiangqiQuietKeyMove,
  isXiangqiSolverMoveUnique,
  isXiangqiUniquelyWinning,
  makeXiangqiPuzzleInitial,
  tagXiangqiPuzzleThemes,
  validateStandardXiangqiPuzzle,
  XIANGQI_MATE_SCORE_CP,
  type XiangqiBoard,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiPuzzleAttributionIssue,
  xiangqiPuzzleTitle,
  xiangqiSourceAttribution,
  xiangqiUciScoreToCp,
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

const UNIQUE_OPTS = { winCp: 250, uniqueGapCp: 150 };

test('isXiangqiUniquelyWinning requires a winning best line', () => {
  assert.equal(isXiangqiUniquelyWinning([{ scoreCp: 200, mate: null }], UNIQUE_OPTS), false);
  assert.equal(isXiangqiUniquelyWinning([], UNIQUE_OPTS), false);
});

test('isXiangqiUniquelyWinning accepts an only-move (no second line)', () => {
  assert.equal(isXiangqiUniquelyWinning([{ scoreCp: 400, mate: null }], UNIQUE_OPTS), true);
});

test('isXiangqiUniquelyWinning enforces the cp gap between best and second', () => {
  assert.equal(
    isXiangqiUniquelyWinning(
      [
        { scoreCp: 500, mate: null },
        { scoreCp: 300, mate: null },
      ],
      UNIQUE_OPTS,
    ),
    true,
  );
  assert.equal(
    isXiangqiUniquelyWinning(
      [
        { scoreCp: 500, mate: null },
        { scoreCp: 400, mate: null },
      ],
      UNIQUE_OPTS,
    ),
    false,
  );
});

test('isXiangqiUniquelyWinning accepts a lone mate over a non-mate second line', () => {
  assert.equal(
    isXiangqiUniquelyWinning(
      [
        { scoreCp: XIANGQI_MATE_SCORE_CP - 3, mate: 3 },
        { scoreCp: 800, mate: null },
      ],
      UNIQUE_OPTS,
    ),
    true,
  );
  // Two mates within the gap: not unique.
  assert.equal(
    isXiangqiUniquelyWinning(
      [
        { scoreCp: XIANGQI_MATE_SCORE_CP - 3, mate: 3 },
        { scoreCp: XIANGQI_MATE_SCORE_CP - 5, mate: 5 },
      ],
      UNIQUE_OPTS,
    ),
    false,
  );
});

// ── Winning-floor per-ply uniqueness (gated re-mine) ─────────────────────────

// winHi 0.80 ~ +240cp, winLo 0.60 ~ +70cp on the K=400 logistic.
const SOLVER_UNIQUE_OPTS = { winHi: 0.8, winLo: 0.6, minGapCp: 200 };

test('isXiangqiSolverMoveUnique: only-move (no runner-up) is unique', () => {
  assert.equal(
    isXiangqiSolverMoveUnique({ scoreCp: 400, mate: null }, undefined, SOLVER_UNIQUE_OPTS),
    true,
  );
});

test('isXiangqiSolverMoveUnique: a losing only move is not a puzzle answer', () => {
  assert.equal(
    isXiangqiSolverMoveUnique({ scoreCp: -400, mate: null }, undefined, SOLVER_UNIQUE_OPTS),
    false,
  );
});

test('isXiangqiSolverMoveUnique: best must clear the winning floor', () => {
  // +150cp is winning-ish but below winHi (~+240): not a puzzle move.
  assert.equal(
    isXiangqiSolverMoveUnique(
      { scoreCp: 150, mate: null },
      { scoreCp: -50, mate: null },
      SOLVER_UNIQUE_OPTS,
    ),
    false,
  );
});

test('isXiangqiSolverMoveUnique: two still-winning moves a small gap apart are NOT unique', () => {
  // +600 vs +550: both crushing, 50cp apart — forcing one is unfair.
  assert.equal(
    isXiangqiSolverMoveUnique(
      { scoreCp: 600, mate: null },
      { scoreCp: 550, mate: null },
      SOLVER_UNIQUE_OPTS,
    ),
    false,
  );
});

test('isXiangqiSolverMoveUnique: unique when the runner-up loses the win', () => {
  // +600 vs +40 (~win% 0.53, below winLo): the alternative throws the win.
  assert.equal(
    isXiangqiSolverMoveUnique(
      { scoreCp: 600, mate: null },
      { scoreCp: 40, mate: null },
      SOLVER_UNIQUE_OPTS,
    ),
    true,
  );
});

test('isXiangqiSolverMoveUnique: hard near-tie floor rejects a boundary-sensitive result', () => {
  const verdict = classifyXiangqiSolverMoveUniqueness(
    { scoreCp: 270, mate: null },
    { scoreCp: 71, mate: null },
    SOLVER_UNIQUE_OPTS,
  );
  assert.deepEqual(verdict, { unique: false, reason: 'near-tie' });

  assert.deepEqual(
    classifyXiangqiSolverMoveUniqueness(
      { scoreCp: 270, mate: null },
      { scoreCp: 70, mate: null },
      SOLVER_UNIQUE_OPTS,
    ),
    { unique: true, reason: 'runner-up-loses-win' },
  );
});

test('isXiangqiSolverMoveUnique: a runner-up that still wins is a second answer, whatever the margin', () => {
  // +900 vs +600: the runner-up still wins (~97%), so failing it would be unfair.
  assert.deepEqual(
    classifyXiangqiSolverMoveUniqueness(
      { scoreCp: 900, mate: null },
      { scoreCp: 600, mate: null },
      SOLVER_UNIQUE_OPTS,
    ),
    { unique: false, reason: 'alternative-still-good' },
  );
});

test('isXiangqiSolverMoveUnique: a mate is unique only when no other move mates', () => {
  // Faster mate over a slower mate: NOT unique. The grader only rescues a mate
  // on the spot, so a served puzzle with a second forced mate is a trap.
  assert.equal(
    isXiangqiSolverMoveUnique(
      { scoreCp: XIANGQI_MATE_SCORE_CP - 3, mate: 3 },
      { scoreCp: XIANGQI_MATE_SCORE_CP - 5, mate: 5 },
      SOLVER_UNIQUE_OPTS,
    ),
    false,
  );
  // Two mates of equal distance: not unique.
  assert.equal(
    isXiangqiSolverMoveUnique(
      { scoreCp: XIANGQI_MATE_SCORE_CP - 3, mate: 3 },
      { scoreCp: XIANGQI_MATE_SCORE_CP - 3, mate: 3 },
      SOLVER_UNIQUE_OPTS,
    ),
    false,
  );
  // Lone mate over a non-mate second line: unique.
  assert.equal(
    isXiangqiSolverMoveUnique(
      { scoreCp: XIANGQI_MATE_SCORE_CP - 3, mate: 3 },
      { scoreCp: 800, mate: null },
      SOLVER_UNIQUE_OPTS,
    ),
    true,
  );
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

test('assembleMinedXiangqiPuzzle: the trim beats a 5-ply floor unless floorAfterTrim holds it', () => {
  const opts = { maxSolutionPlies: 9, minSolutionPlies: 5 };
  // Old behaviour: the 5-ply line passes the floor, then trims to 1 ply.
  const loose = assembleMinedXiangqiPuzzle(looseHorseInput(), opts);
  assert.equal(loose.ok, true);
  if (loose.ok) assert.equal(loose.puzzle.solution.length, 1);
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
