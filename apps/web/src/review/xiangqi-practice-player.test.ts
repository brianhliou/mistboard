// The practice PLAYER against the real kernel and a scripted engine. The runner
// tests prove the state machine; this proves the surface a learner actually sees
// -- that the goal is stated, that a failing move says so and offers a take-back,
// that the hint is DRAWN on the board rather than described, and that the board
// is closed while the engine is thinking.

import {
  endgameEntryState,
  getStandardXiangqiLegalMoves,
  type PracticeGoal,
  XIANGQI_ENDGAME_CORPUS,
  type XiangqiGameState,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { expect, test } from 'vitest';
import type { PracticeEval } from './practice-play.js';
import { mountXiangqiPractice } from './xiangqi-practice-player.js';

const entry = (id: string) => {
  const found = XIANGQI_ENDGAME_CORPUS.find((row) => row.id === id);
  if (!found) throw new Error(`no endgame corpus entry "${id}"`);
  return found;
};

const MATE: PracticeGoal = { kind: 'mate' };

/** Engine with a fixed opinion in Red's favour, reported side-to-move. */
function steady(redCp: number) {
  return async (truth: XiangqiGameState): Promise<PracticeEval> => {
    if (truth.status.type !== 'playing') return { cp: null, mate: null, bestUci: null };
    const best = getStandardXiangqiLegalMoves(truth)[0];
    return {
      cp: truth.status.turn === 'red' ? redCp : -redCp,
      mate: null,
      bestUci: best ? xiangqiMoveToFsfUci(best) : null,
    };
  };
}

/**
 * An engine whose opinion COLLAPSES the moment the learner has moved, so any
 * move reads as having thrown the win away. That drives the failure path.
 *
 * Keyed on side to move rather than on a counter: Red is the learner here, so
 * "Black to move" IS "the learner has just moved", and deriving it needs no
 * state that could fall out of step with the position.
 */
function collapsing(beforeCp: number, afterCp: number) {
  return async (truth: XiangqiGameState): Promise<PracticeEval> => {
    if (truth.status.type !== 'playing') return { cp: null, mate: null, bestUci: null };
    const redToMove = truth.status.turn === 'red';
    const redCp = redToMove ? beforeCp : afterCp;
    const best = getStandardXiangqiLegalMoves(truth)[0];
    return {
      // Reported side-to-move, as a real engine does; the runner flips it.
      cp: redToMove ? redCp : -redCp,
      mate: null,
      bestUci: best ? xiangqiMoveToFsfUci(best) : null,
    };
  };
}

function mount(
  evaluate: (t: XiangqiGameState) => Promise<PracticeEval>,
  goal: PracticeGoal = MATE,
) {
  const row = entry('soldier-vs-bare-general');
  const host = document.createElement('div');
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal,
    orientation: row.turn,
    evaluate,
    replyDelayMs: 0,
    title: 'Basic endgames',
    summary: row.attacker,
  });
  return { host, handle };
}

const text = (host: HTMLElement, selector: string): string =>
  host.querySelector<HTMLElement>(selector)?.textContent ?? '';

const hidden = (host: HTMLElement, label: string): boolean => {
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button labelled "${label}"`);
  // `hidden` is typed boolean | "until-found" in current lib.dom; the player only
  // ever assigns a boolean, so an exact match is the honest read.
  return btn.hidden === true;
};

test('the goal and its explanation sit under the board and stay there', async () => {
  const { host, handle } = mount(steady(700));
  await handle.ready();
  // A practice exercise has no per-move prompt, so the brief has to persist --
  // and it lives UNDER THE BOARD, in the learner's eyeline while they study the
  // position, not off in the side panel.
  const briefEl = host.querySelector('.practice__board-col .practice__brief');
  expect(briefEl, 'the brief belongs in the board column').not.toBeNull();
  expect(text(host, '.practice__brief-goal')).toBe('Checkmate');
  expect(text(host, '.gamebook__feedback')).toBe('Your move.');
});

test('the concept prose is rendered when the chapter supplies one', async () => {
  const row = entry('soldier-vs-bare-general');
  const host = document.createElement('div');
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal: MATE,
    orientation: row.turn,
    evaluate: steady(700),
    replyDelayMs: 0,
    brief: 'Tempo decides it.',
  });
  await handle.ready();
  expect(text(host, '.practice__brief-text')).toBe('Tempo decides it.');
});

test('the resize grip hangs off a frame the board repaint cannot destroy', async () => {
  const { host, handle } = mount(steady(700));
  await handle.ready();
  const grip = host.querySelector('.board-resize-grip');
  expect(grip, 'the board should carry a resize grip').not.toBeNull();
  // The board host is repainted with innerHTML on every move, so a grip parented
  // to it disappears on the first move. It must hang off the stable frame.
  expect(grip?.parentElement?.classList.contains('practice__board-frame')).toBe(true);

  const move = getStandardXiangqiLegalMoves(
    endgameEntryState(entry('soldier-vs-bare-general')),
  )[0]!;
  await handle.play(move);
  expect(
    host.querySelector('.board-resize-grip'),
    'the grip must survive a board repaint',
  ).not.toBeNull();
});

test('a sound move is accepted and play continues against the engine', async () => {
  const { host, handle } = mount(steady(700));
  await handle.ready();

  const first = getStandardXiangqiLegalMoves(
    endgameEntryState(entry('soldier-vs-bare-general')),
  )[0]!;
  await handle.play(first);

  expect(handle.view().phase).toBe('play');
  expect(handle.view().movesPlayed).toBe(1);
  expect(text(host, '.gamebook__feedback')).toBe('Good. Keep going.');
  expect(hidden(host, 'Take it back'), 'no take-back is offered after a sound move').toBe(true);
});

test('a move that throws the win away fails, explains, and offers a take-back', async () => {
  const { host, handle } = mount(collapsing(900, 0));
  await handle.ready();

  const first = getStandardXiangqiLegalMoves(
    endgameEntryState(entry('soldier-vs-bare-general')),
  )[0]!;
  await handle.play(first);

  expect(handle.view().phase).toBe('failed');
  expect(text(host, '.gamebook__feedback')).toContain('throws it away');
  expect(hidden(host, 'Take it back')).toBe(false);
  expect(handle.view().awaitingMove, 'the board is closed until the move is taken back').toBe(
    false,
  );
});

test('take-back returns the learner to the position before the failing move', async () => {
  const { host, handle } = mount(collapsing(900, 0));
  await handle.ready();
  const first = getStandardXiangqiLegalMoves(
    endgameEntryState(entry('soldier-vs-bare-general')),
  )[0]!;
  await handle.play(first);

  const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Take it back')!;
  retry.click();

  expect(handle.view().phase).toBe('play');
  expect(handle.view().movesPlayed).toBe(0);
  expect(hidden(host, 'Take it back')).toBe(true);
});

test('the hint is drawn on the board, escalating from a ring to an arrow', async () => {
  const { host, handle } = mount(steady(700));
  await handle.ready();
  const hintBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Hint')!;

  expect(host.querySelectorAll('.xq-marker').length, 'nothing is marked before asking').toBe(0);

  hintBtn.click();
  expect(handle.view().hint?.level).toBe('origin');
  const ring = host.querySelector('.xq-marker');
  expect(ring, 'the first hint rings the piece to move').not.toBeNull();
  // Asserting the element EXISTS is not enough and once was not: a circle marker
  // renders fill="none" with a stroke-width and no stroke colour, so without the
  // class that supplies the stroke it sits on the board perfectly positioned and
  // completely invisible. That shipped, and this test passed, until it was
  // opened in a browser.
  expect(
    ring?.classList.contains('xq-marker--practice-hint'),
    'the ring must carry the class that gives it a stroke colour',
  ).toBe(true);
  expect(text(host, '.gamebook__hint')).toBe('This piece has the move.');

  hintBtn.click();
  expect(handle.view().hint?.level).toBe('move');
  expect(host.querySelectorAll('.xq-marker').length, 'the ring gives way to the arrow').toBe(0);
  const arrow = host.querySelector('.xq-arrow');
  expect(arrow, 'the second hint draws the whole move').not.toBeNull();
  expect(text(host, '.gamebook__hint')).toBe('This is the move.');
});

test('the board is closed while the engine is thinking', async () => {
  // Initialised to a no-op rather than null: TypeScript cannot see the executor
  // assign it, so a nullable here would narrow to `null` at the call site.
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  let first = true;
  const evaluate = async (truth: XiangqiGameState): Promise<PracticeEval> => {
    // Let the opening evaluation through; stall the one after the learner moves.
    if (!first) await gate;
    first = false;
    return steady(700)(truth);
  };

  const { host, handle } = mount(evaluate);
  await handle.ready();

  const move = getStandardXiangqiLegalMoves(
    endgameEntryState(entry('soldier-vs-bare-general')),
  )[0]!;
  const pending = handle.play(move);
  // Synchronously after the drag, the panel says so and the move is not yet graded.
  expect(text(host, '.gamebook__feedback')).toBe('Thinking…');
  expect(hidden(host, 'Hint'), 'no hint while the engine is mid-search').toBe(true);

  release();
  await pending;
  expect(text(host, '.gamebook__feedback')).toBe('Good. Keep going.');
});

test("a solve is reported once, with the learner's move count", async () => {
  const row = entry('soldier-vs-bare-general');
  const host = document.createElement('div');
  const solves: number[] = [];
  // A `win` goal so the solve is reachable by EVALUATION in one move. An
  // unbounded `mate` goal succeeds only on a real checkmate, which one legal
  // move from this position will not produce -- a test written against it would
  // never reach success and would assert nothing.
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal: { kind: 'win', centipawns: 600 },
    orientation: row.turn,
    evaluate: steady(900),
    replyDelayMs: 0,
    onSolved: (moves) => solves.push(moves),
  });
  await handle.ready();
  expect(solves, 'nothing is reported before a solve').toEqual([]);

  const move = getStandardXiangqiLegalMoves(endgameEntryState(row))[0]!;
  await handle.play(move);

  expect(handle.view().phase, 'the fake must actually reach success').toBe('success');
  expect(solves.length, 'reported exactly once').toBe(1);
  expect(solves[0]).toBe(handle.view().movesPlayed);
});

test('a solve is not re-reported when the learner restarts and solves again', async () => {
  const row = entry('soldier-vs-bare-general');
  const host = document.createElement('div');
  const solves: number[] = [];
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal: { kind: 'win', centipawns: 600 },
    orientation: row.turn,
    evaluate: steady(900),
    replyDelayMs: 0,
    onSolved: (moves) => solves.push(moves),
  });
  await handle.ready();
  const move = getStandardXiangqiLegalMoves(endgameEntryState(row))[0]!;
  await handle.play(move);
  expect(solves.length).toBe(1);

  // render() runs on every state change, including restart; without the guard
  // the report would fire again each time the success state was re-rendered.
  const restart = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Restart');
  restart?.click();
  await handle.play(move);
  expect(solves.length, 'one mount, one report').toBe(1);
});

test('a failure is reported once per attempt, with its verdict', async () => {
  const row = entry('soldier-vs-bare-general');
  const host = document.createElement('div');
  const failures: { verdict: string; moves: number }[] = [];
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal: MATE,
    orientation: row.turn,
    evaluate: collapsing(900, 0),
    replyDelayMs: 0,
    onFailed: (verdict, moves) => failures.push({ verdict, moves }),
  });
  await handle.ready();
  expect(failures).toEqual([]);

  const move = getStandardXiangqiLegalMoves(endgameEntryState(row))[0]!;
  await handle.play(move);
  expect(handle.view().phase, 'the fake must actually fail the attempt').toBe('failed');
  expect(failures.length).toBe(1);
  expect(failures[0]?.verdict).toBe('blunder');

  // Asking for a hint re-renders the SAME failed state; a report keyed on the
  // phase rather than the transition into it would count that as a second
  // failure and inflate the difficulty signal.
  const hintBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Hint');
  hintBtn?.click();
  expect(failures.length, 'one failure, one report').toBe(1);
});

test('the learner sees their own move while the engine is still thinking', async () => {
  const row = entry('soldier-vs-bare-general');
  const host = document.createElement('div');
  // What the move list showed at the moment each search STARTED. The engine call
  // is the only synchronous window into mid-attempt state.
  const shownAtSearch: number[] = [];
  const engine = steady(700);
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal: MATE,
    orientation: row.turn,
    replyDelayMs: 0,
    evaluate: async (truth) => {
      shownAtSearch.push(host.querySelectorAll('.practice__move').length);
      return engine(truth);
    },
  });
  await handle.ready();
  shownAtSearch.length = 0;

  const move = getStandardXiangqiLegalMoves(endgameEntryState(row))[0]!;
  await handle.play(move);

  // The search that grades the learner's move must already see it on the board.
  // Without the repaint on the ply hook, the position holds still for the whole
  // search and then jumps two plies at once -- so the click the learner just
  // heard describes a board they cannot see yet.
  expect(shownAtSearch[0], "the learner's move is painted before the search").toBe(1);
});

test("the engine's reply is on the board while the position after it is still being evaluated", async () => {
  // The defender's sound fires as its ply lands; the evaluation of the position
  // after it waits on a tablebase round trip. The board must show the reply in
  // the same task as the sound, not after that round trip.
  const row = entry('soldier-vs-bare-general');
  const host = document.createElement('div');
  const engine = steady(700);
  const boardSquares = () =>
    [...host.querySelectorAll<HTMLElement>('.gamebook__board [data-piece-square]')]
      .map((el) => el.dataset.pieceSquare)
      .sort()
      .join(',');
  const truthSquares = (truth: XiangqiGameState) =>
    Object.entries(truth.board)
      .filter(([, piece]) => piece)
      .map(([square]) => square)
      .sort()
      .join(',');
  // Per search: did the board already show the position being searched?
  const boardMatchedAtSearch: boolean[] = [];
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal: MATE,
    orientation: row.turn,
    replyDelayMs: 0,
    evaluate: async (truth) => {
      boardMatchedAtSearch.push(boardSquares() === truthSquares(truth));
      return engine(truth);
    },
  });
  await handle.ready();
  boardMatchedAtSearch.length = 0;

  const move = getStandardXiangqiLegalMoves(endgameEntryState(row))[0]!;
  await handle.play(move);

  expect(boardMatchedAtSearch, "learner's move, then the engine's reply").toEqual([true, true]);
});
