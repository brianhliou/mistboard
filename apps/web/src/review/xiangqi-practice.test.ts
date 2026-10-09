// The practice runner against the REAL xiangqi kernel and a real endgame-corpus
// position. practice-play.test.ts proves the state machine with a toy game; this
// proves the wiring that toy cannot: kernel legality, the FSF-UCI round trip the
// defender's reply depends on, the side-to-move -> learner POV flip against a
// board where the turn actually alternates, and the finished-status mapping.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  endgameEntryState,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiLegalMove,
  type PracticeGoal,
  parsePracticeGoal,
  parseStandardXiangqiFen,
  XIANGQI_ENDGAME_CORPUS,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiEndgamePracticeSets,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { beforeEach, expect, test } from 'vitest';
import type { CevalHandle } from './engine/ceval-types.js';
import { createPracticeSession, type PracticeEval } from './practice-play.js';
import {
  clearPracticeKnownExact,
  evaluateXiangqiForPractice,
  xiangqiPracticeConfig,
  xiangqiPracticeTermination,
} from './xiangqi-practice.js';

const entry = (id: string) => {
  const found = XIANGQI_ENDGAME_CORPUS.find((row) => row.id === id);
  if (!found) throw new Error(`no endgame corpus entry "${id}"`);
  return found;
};

/**
 * A scripted engine that holds a FIXED opinion in RED's favour and reports it in
 * the side-to-move dialect the real engine uses. Because the opinion never
 * changes, every move grades `good`, which isolates the wiring: anything that
 * fails here is a POV, legality, or UCI defect rather than a grading one.
 */
function steadyEngine(redCp: number) {
  return async (truth: XiangqiGameState): Promise<PracticeEval> => {
    if (truth.status.type !== 'playing') return { cp: null, mate: null, bestUci: null };
    const mover = truth.status.turn;
    const legal = getStandardXiangqiLegalMoves(truth);
    const best = legal[0];
    return {
      cp: mover === 'red' ? redCp : -redCp,
      mate: null,
      bestUci: best ? xiangqiMoveToFsfUci(best) : null,
    };
  };
}

const MATE: PracticeGoal = { kind: 'mate' };

// Results learned from a parent's table are module state; no test may inherit
// another's.
beforeEach(() => clearPracticeKnownExact());

test('a corpus endgame runs: the learner moves, the engine defends, play continues', async () => {
  const row = entry('soldier-vs-bare-general');
  expect(row.verdict, 'the fixture should be a book WIN, so the goal is to convert').toBe('win');

  const start = endgameEntryState(row);
  expect(start.status.type).toBe('playing');

  const session = createPracticeSession(
    xiangqiPracticeConfig({
      goal: MATE,
      learner: row.turn,
      initialTruth: start,
      evaluate: steadyEngine(700),
      minReplyDelayMs: 0,
    }),
  );
  await session.start();
  expect(session.view().phase, 'a book win must not self-complete on load').toBe('play');
  expect(session.view().movesPlayed).toBe(0);

  const first = getStandardXiangqiLegalMoves(session.truth())[0]!;
  const verdict = await session.attempt(first);

  expect(verdict).toBe('good');
  expect(session.view().movesPlayed).toBe(1);
  expect(session.view().phase, 'play should continue after a sound move').toBe('play');
  // Learner move + engine reply, and it is the learner's turn again.
  const truth = session.truth();
  expect(truth.status.type === 'playing' && truth.status.turn).toBe(row.turn);
});

test("the defender actually plays the engine's move, round-tripped through FSF UCI", async () => {
  const row = entry('soldier-vs-bare-general');
  const start = endgameEntryState(row);

  // Predict the reply: the engine returns the first legal move of whatever
  // position it is handed, so we can compute what the defender must play.
  const learnerMove = getStandardXiangqiLegalMoves(start)[0]!;
  const afterLearner = applyStandardXiangqiMove(start, learnerMove);
  const expectedReply = getStandardXiangqiLegalMoves(afterLearner)[0]!;
  const afterReply = applyStandardXiangqiMove(afterLearner, expectedReply);

  const session = createPracticeSession(
    xiangqiPracticeConfig({
      goal: MATE,
      learner: row.turn,
      initialTruth: start,
      evaluate: steadyEngine(700),
      minReplyDelayMs: 0,
    }),
  );
  await session.start();
  await session.attempt(learnerMove);

  // If fromUci or moveKey drifted apart, the defender would play a different
  // move (or none) and this board would not match.
  expect(session.truth().board).toEqual(afterReply.board);
});

test('the kernel rejects an illegal move without consuming the attempt', async () => {
  const row = entry('soldier-vs-bare-general');
  const start = endgameEntryState(row);
  const session = createPracticeSession(
    xiangqiPracticeConfig({
      goal: MATE,
      learner: row.turn,
      initialTruth: start,
      evaluate: steadyEngine(700),
      minReplyDelayMs: 0,
    }),
  );
  await session.start();

  // Red's soldier stands on e6 and cannot move backwards. The move object is
  // structurally valid (XiangqiMove is exactly { from, to }) and the square is
  // occupied by the learner's own piece, so 'invalid' here can only mean the
  // kernel judged the DIRECTION illegal.
  expect(await session.attempt({ from: 'e6', to: 'e5' })).toBe('invalid');
  expect(session.view().movesPlayed).toBe(0);
  expect(session.view().phase).toBe('play');

  // The same soldier moving forward is accepted, which is what makes the
  // rejection above a statement about legality rather than about move shape.
  expect(await session.attempt({ from: 'e6', to: 'e7' })).toBe('good');
  expect(session.view().movesPlayed).toBe(1);
});

test('every corpus entry compiles to a position the runner can open', async () => {
  // A guard on the content, not the code: an entry whose position is already
  // finished, or whose side to move has no legal move, is not an exercise. This
  // is the check that would have caught a bad FEN before it reached a learner.
  for (const row of XIANGQI_ENDGAME_CORPUS) {
    const start = endgameEntryState(row);
    expect(start.status.type, `${row.id} should start playable`).toBe('playing');
    expect(
      getStandardXiangqiLegalMoves(start).length,
      `${row.id} should have a legal move for ${row.turn}`,
    ).toBeGreaterThan(0);

    const session = createPracticeSession(
      xiangqiPracticeConfig({
        goal: row.verdict === 'win' ? MATE : { kind: 'draw' },
        learner: row.turn,
        initialTruth: start,
        evaluate: steadyEngine(row.verdict === 'win' ? 700 : 0),
        minReplyDelayMs: 0,
      }),
    );
    await session.start();
    expect(session.view().phase, `${row.id} should hand the learner the move`).toBe('play');
  }
});

test('xiangqiPracticeTermination maps a finished game onto the learner result', () => {
  const playing = createInitialXiangqiState('fixture');
  expect(xiangqiPracticeTermination(playing, 'red')).toBe('none');

  const won: XiangqiGameState = {
    ...playing,
    status: { type: 'finished', winner: 'red', reason: 'checkmate' },
  };
  expect(xiangqiPracticeTermination(won, 'red')).toBe('learner-wins');
  expect(xiangqiPracticeTermination(won, 'black')).toBe('learner-loses');

  const drawn: XiangqiGameState = {
    ...playing,
    status: { type: 'finished', winner: null, reason: 'repetition' },
  };
  expect(xiangqiPracticeTermination(drawn, 'red')).toBe('drawn');
  expect(xiangqiPracticeTermination(drawn, 'black')).toBe('drawn');
});

// The tablebase rides beside the engine search. A fake ceval answers with one
// line; the lookup is injected, so no network is involved.
const fakeCeval = (scoreCp: number): CevalHandle =>
  ({
    evaluate: async () => ({ lines: [{ scoreCp, mate: null, pvUci: ['e1e2'] }] }),
  }) as unknown as CevalHandle;

test('practice eval carries an exact tablebase result beside the engine score', async () => {
  const truth = createInitialXiangqiState('t');
  const evaluation = await evaluateXiangqiForPractice(fakeCeval(120), truth, async () => ({
    status: 'exact',
    result: 'win',
    dtm: 9,
    moves: [{ from: 'e1', to: 'e2', result: 'win', dtm: 9 }],
  }));
  const { exactLater, ...engine } = evaluation;
  expect(engine).toEqual({ cp: 120, mate: null, bestUci: 'e1e2' });
  expect(await exactLater).toEqual({ result: 'win' });
});

test('practice eval: no tablebase answer, or a failing lookup, is null and never a draw', async () => {
  const truth = createInitialXiangqiState('t');
  const none = await evaluateXiangqiForPractice(fakeCeval(40), truth, async () => ({
    status: 'none',
  }));
  expect(await none.exactLater).toBeNull();
  const thrown = await evaluateXiangqiForPractice(fakeCeval(40), truth, async () => {
    throw new Error('offline');
  });
  expect(await thrown.exactLater).toBeNull();
  expect(thrown.cp).toBe(40);
});

test("the position after a move is graded from the parent's table, with no second lookup", async () => {
  // An exact answer lists every legal move's result, so the lookup for the
  // position after the learner's move is already answered by the one made for
  // the position before it. Asking again put a paced chessdb round trip
  // between the learner's move and the engine's reply.
  const parent = createInitialXiangqiState('t');
  const parentEval = await evaluateXiangqiForPractice(fakeCeval(300), parent, async () => ({
    status: 'exact',
    result: 'win',
    dtm: 9,
    moves: [
      { from: 'e1', to: 'e2', result: 'win', dtm: 9 },
      { from: 'a1', to: 'a2', result: 'draw', dtm: null },
    ],
  }));
  await parentEval.exactLater;

  let asked = 0;
  const lookup = async () => {
    asked += 1;
    return { status: 'none' } as const;
  };
  // The mover's result, flipped to the side now to move.
  const afterWin = applyStandardXiangqiMove(parent, { from: 'e1', to: 'e2' });
  expect((await evaluateXiangqiForPractice(fakeCeval(-300), afterWin, lookup)).exact).toEqual({
    result: 'loss',
  });
  const afterDraw = applyStandardXiangqiMove(parent, { from: 'a1', to: 'a2' });
  expect((await evaluateXiangqiForPractice(fakeCeval(0), afterDraw, lookup)).exact).toEqual({
    result: 'draw',
  });
  expect(asked, 'both answered from the parent table').toBe(0);

  // A position no table has covered is still looked up.
  const unrelated = applyStandardXiangqiMove(parent, { from: 'i1', to: 'i2' });
  const uncovered = await evaluateXiangqiForPractice(fakeCeval(0), unrelated, lookup);
  expect(await uncovered.exactLater).toBeNull();
  expect(asked).toBe(1);
});

// ── Draw chapters conclude ───────────────────────────────────────────────────
//
// A "draw in 15" chapter is held by shuffling, and the natural way a shuffle
// ends is the kernel's three-fold repetition draw. A run that ended on the
// LEARNER's repeating move was graded as having left the drawing band (a
// finished position has no evaluation, so it read as "unclear"), and a held draw
// failed. Every draw chapter is driven here, not only the one a learner reported.

/** Play `from -> to` back, or the first quiet move whose reverse stays legal. */
function shuffleMove(truth: XiangqiGameState, last: XiangqiMove | undefined): XiangqiMove {
  if (last) {
    const back = { from: last.to, to: last.from };
    if (isStandardXiangqiLegalMove(truth, back)) return back;
  }
  for (const move of getStandardXiangqiLegalMoves(truth)) {
    if (truth.board[move.to]) continue;
    const after = applyStandardXiangqiMove(truth, move);
    if (after.status.type !== 'playing') continue;
    return move;
  }
  throw new Error(`no quiet shuffle from ${JSON.stringify(truth.board)}`);
}

const drawChapters = xiangqiEndgamePracticeSets().flatMap((set) =>
  set.chapters
    .filter((chapter) => chapter.goal.startsWith('draw'))
    .map((chapter) => ({ ...chapter, slug: set.slug })),
);

test('the corpus has draw chapters to drive', () => {
  expect(drawChapters.length).toBeGreaterThan(5);
});

test.each(drawChapters.map((chapter) => [`${chapter.slug}/${chapter.id}`, chapter] as const))(
  'draw chapter %s: a repetition completed by the learner holds the draw',
  async (_label, chapter) => {
    const parsed = parseStandardXiangqiFen(chapter.fen);
    if (!parsed.ok) throw new Error(`bad fen ${chapter.fen}`);
    const goal = parsePracticeGoal(chapter.goal);
    if (!goal) throw new Error(`bad goal ${chapter.goal}`);
    const learner = chapter.orientation;
    const defenderLast: { move?: XiangqiMove } = {};

    // Level from both sides, with no tablebase: the engine path alone must
    // carry the result. The defender shuffles one piece back and forth.
    const session = createPracticeSession(
      xiangqiPracticeConfig({
        goal,
        learner,
        initialTruth: parsed.state,
        minReplyDelayMs: 0,
        evaluate: async (truth) => {
          if (truth.status.type !== 'playing') return { cp: null, mate: null, bestUci: null };
          if (truth.status.turn === learner) {
            return { cp: 0, mate: null, bestUci: null };
          }
          const move = shuffleMove(truth, defenderLast.move);
          defenderLast.move = move;
          return { cp: 0, mate: null, bestUci: xiangqiMoveToFsfUci(move) };
        },
      }),
    );
    await session.start();

    // The learner shuffles too, so the position cycles every four plies; with
    // the defender moving first, the learner's move is the one that repeats.
    let mine: XiangqiMove | undefined;
    let played = 0;
    while (session.view().phase === 'play' && played < 40) {
      mine = shuffleMove(session.truth(), mine);
      expect(await session.attempt(mine)).not.toBe('invalid');
      played += 1;
    }
    const truth = session.truth();
    expect(
      truth.status.type === 'finished' ? truth.status.reason : 'playing',
      'the shuffle reaches the repetition draw before the move budget',
    ).toBe('repetition');
    expect(played, 'the learner made the repeating move').toBeLessThan(goal.moves ?? 99);
    expect(session.view().phase, 'a drawn game is a held draw').toBe('success');
  },
);
