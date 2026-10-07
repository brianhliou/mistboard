// Practice (engine-adjudicated exercise) play engine — the counterpart to
// gamebook-play.ts, and deliberately its opposite.
//
// A gamebook walks an AUTHORED tree: the solution is the mainline, the opponent
// replies are whatever the author wrote, and a wrong move is wrong because it
// left the line. That costs an author per exercise.
//
// A practice exercise has no tree at all. It is a position plus a goal string.
// The opponent's replies come from the engine's best move, and the learner's
// move is judged by how much win probability it gave up — so nobody has to
// write down the answer, and any position with a known verdict is an exercise.
// That is the whole reason this exists: it is the only lesson surface that
// scales without authoring.
//
// Variant-agnostic and view-agnostic, exactly like gamebook-play: a view layer
// drives it with attempted moves and renders what it returns. The engine is
// injected as a plain async function, so this file has no dependency on ceval
// and is testable against a fake engine.

import {
  evaluatePracticeGoal,
  type PracticeGoal,
  type PracticeOutcome,
  type PracticeTermination,
  type PracticeVerdict,
  practiceJudgment,
  practiceMoveAbandonsGoal,
  winPercent,
} from '@mistboard/game';

/** An engine evaluation of one position, from the SIDE TO MOVE's point of view. */
export interface PracticeEval {
  cp: number | null;
  mate: number | null;
  /** Engine UCI of the best move here; the defender plays this. */
  bestUci: string | null;
  /**
   * The exact game-theoretic result of this position, from an endgame tablebase,
   * in the same point of view as the score. Absent or null whenever there is no
   * EXACT answer: an outage, an uncovered position, a half-solved one. Never a
   * guess, so its absence must never be read as a draw.
   */
  exact?: { result: PracticeExactResult } | null;
  /**
   * The exact result when it is still on its way (a tablebase round trip), in
   * the same point of view; `exact` is then absent. The runner hands the board
   * to the learner without waiting for it and waits only where the answer is
   * read: grading a move, or a goal check the answer could change. Resolves to
   * null on any failure, never rejects into a verdict.
   */
  exactLater?: Promise<{ result: PracticeExactResult } | null>;
}

export type PracticeExactResult = 'win' | 'draw' | 'loss';

/** What the tablebase said about the learner's last move, when it graded it. */
export type PracticeTablebaseOutcome = 'keepsWin' | 'holdsDraw' | 'throwsWin' | 'loses';

export type PracticePhase =
  /** Waiting on the engine (opening evaluation, or the defender thinking). */
  | 'thinking'
  /** The learner is on the move. */
  | 'play'
  /** The learner's last move failed the exercise; they may retry or restart. */
  | 'failed'
  /** Goal achieved. */
  | 'success'
  /** The exercise ended against the learner (mated, or the goal became unreachable). */
  | 'defeat';

export interface PracticeView {
  phase: PracticePhase;
  /** The learner's own moves played so far. */
  movesPlayed: number;
  /** Verdict on the most recent learner move, when there is one. */
  verdict: PracticeVerdict | null;
  /** Win% from the learner's POV at the current position; null before the first eval. */
  winPercent: number | null;
  /** Whether the board should accept a move from the learner. */
  awaitingMove: boolean;
  /**
   * The line played so far, in board notation, learner and defender alternating.
   * A practice exercise has no move list of its own the way a study chapter
   * does, so without this the learner cannot see what they just did -- which is
   * most of what makes a failed attempt legible.
   */
  moves: readonly string[];
  /**
   * Engine-derived hint for the move to find, revealed in two stages the way
   * lila does it: 'origin' names only the square to move FROM, 'move' gives the
   * whole move. Null when no hint has been asked for, or none is available.
   */
  hint: { level: 'origin'; uci: string } | { level: 'move'; uci: string } | null;
  /**
   * Who graded the last learner move. 'tablebase' when the positions before
   * and after it both had an exact result, and then `tablebase` says what the
   * move did; 'engine' otherwise (the win% curve, as always). Null before the
   * first graded move.
   */
  graded: 'tablebase' | 'engine' | null;
  tablebase: PracticeTablebaseOutcome | null;
}

export interface PracticeConfig<M, T> {
  goal: PracticeGoal;
  /** The side the learner plays; the engine plays every other move. */
  learner: string;
  initialTruth: T;
  isLegal(truth: T, move: M): boolean;
  /** Apply a legal move, returning the successor truth (pure; no mutation). */
  applyMove(truth: T, move: M): T;
  /** Whose turn at this truth, or null when the game has ended. */
  sideToMove(truth: T): string | null;
  /** How (and whether) the game has ended here, from the learner's point of view. */
  termination(truth: T, learner: string): PracticeTermination;
  /** Rebuild a move from the engine's UCI token, for playing the defender's reply. */
  fromUci(uci: string, truth: T): M | null;
  /** Render a move for the move list, given the position it was played FROM
   *  (notation usually needs the parent position to disambiguate). */
  moveLabel(move: M, parentTruth: T): string;
  /**
   * Evaluate a position. MUST come from a search deep enough to trust — lila
   * gates its own goal checks at depth 16, and a shallow eval here produces a
   * confidently wrong verdict rather than an uncertain one.
   */
  evaluate(truth: T): Promise<PracticeEval>;
  /**
   * Notified as each ply lands, with the position it was played FROM, BEFORE
   * the evaluation of the new position is awaited.
   *
   * The runner deliberately keeps no sound or view dependency, and a view layer
   * driving it sees only the settled position: one repaint carrying the
   * learner's move and the engine's reply together, a second or more after the
   * piece was dropped. That is too coarse to sound or to paint. This is the
   * seam for both, and it is optional so the state machine stays testable
   * against a fake engine with nothing attached.
   */
  onMovePlayed?(move: M, parentTruth: T, by: 'learner' | 'defender'): void;
  /**
   * The defender's reply lands no sooner than this many ms after the learner's
   * move did (lichess practice pauses the same way). Measured from the learner's
   * move, so a slow evaluation does not add to it. 0 / absent = no pause.
   */
  minReplyDelayMs?: number;
}

export interface PracticeSession<M, T> {
  truth(): T;
  view(): PracticeView;
  /** Kick off the opening evaluation. Resolves once the learner may move. */
  start(): Promise<void>;
  /**
   * The learner attempts a move.
   * 'invalid' = not playable from here (illegal, or not their turn).
   * Otherwise the returned verdict is the grade; check `view().phase` for the
   * consequence, since a mistake both grades badly and ends the attempt.
   */
  attempt(move: M): Promise<PracticeVerdict | 'invalid'>;
  /** Ask for a hint; call twice to escalate from the origin square to the move. */
  hint(): void;
  /** Take back a failed move and stand again at the position before it. */
  retry(): void;
  /** Restart from the exercise's start position. */
  reset(): Promise<void>;
}

interface Frame<T> {
  truth: T;
  /** Learner-POV evaluation of this position. */
  evaluation: PracticeEval | null;
  movesPlayed: number;
  /** The line that reached this position. Carried ON the frame so retry and
   *  reset restore it by restoring the frame, with no separate bookkeeping to
   *  fall out of step with the board. */
  moves: readonly string[];
  /** Settles once a pending exact result (`exactLater`) has been folded into
   *  `evaluation.exact`; null when nothing is pending. */
  exactReady?: Promise<void> | null;
}

export function createPracticeSession<M, T>(config: PracticeConfig<M, T>): PracticeSession<M, T> {
  let frame: Frame<T> = {
    truth: config.initialTruth,
    evaluation: null,
    movesPlayed: 0,
    moves: [],
  };
  /** The position the learner stood at before their most recent move, for retry. */
  let previous: Frame<T> | null = null;
  let phase: PracticePhase = 'thinking';
  let verdict: PracticeVerdict | null = null;
  let hintLevel = 0;
  let graded: PracticeView['graded'] = null;
  let tablebaseOutcome: PracticeTablebaseOutcome | null = null;

  /** Flip a side-to-move-POV evaluation into the learner's POV. */
  function toLearnerPov(raw: PracticeEval, truth: T): PracticeEval {
    const mover = config.sideToMove(truth);
    if (mover === null || mover === config.learner) return raw;
    return {
      cp: raw.cp === null ? null : -raw.cp,
      mate: raw.mate === null ? null : -raw.mate,
      bestUci: raw.bestUci,
      exact: raw.exact ? { result: flipExact(raw.exact.result) } : null,
    };
  }

  async function evaluateInto(target: Frame<T>): Promise<void> {
    const { exactLater, ...raw } = await config.evaluate(target.truth);
    const evaluation = toLearnerPov(raw, target.truth);
    target.evaluation = evaluation;
    target.exactReady = null;
    if (exactLater) {
      // Folded in when it arrives; the learner is not held for it.
      const flip = config.sideToMove(target.truth) !== config.learner;
      target.exactReady = exactLater.then(
        (exact) => {
          evaluation.exact = exact
            ? { result: flip ? flipExact(exact.result) : exact.result }
            : null;
        },
        () => {
          evaluation.exact = null;
        },
      );
    }
  }

  async function exactSettled(target: Frame<T>): Promise<void> {
    if (target.exactReady) await target.exactReady;
  }

  function adjudicate(assumeExactDraw = false): PracticeOutcome {
    // An exact draw is level, whatever the engine's number says: a depth-16
    // search can read a book draw as -5, and "hold the draw" would then end in
    // defeat on a position the tablebase proves held.
    const exactDraw = assumeExactDraw || frame.evaluation?.exact?.result === 'draw';
    return evaluatePracticeGoal({
      goal: config.goal,
      movesPlayed: frame.movesPlayed,
      cp: exactDraw ? 0 : (frame.evaluation?.cp ?? null),
      mate: exactDraw ? null : (frame.evaluation?.mate ?? null),
      termination: config.termination(frame.truth, config.learner),
    });
  }

  /**
   * Settle the outcome at the current frame; returns true when the run ended.
   * The exact result only enters the goal check as "an exact draw is level", so
   * a pending one is waited for only when that could change the outcome; any
   * other time the learner gets the board before the tablebase answers.
   */
  async function settle(): Promise<boolean> {
    const current = frame;
    if (current.exactReady && adjudicate(false) !== adjudicate(true)) {
      await exactSettled(current);
    }
    const outcome = adjudicate();
    if (outcome === 'success') {
      phase = 'success';
      return true;
    }
    if (outcome === 'failure') {
      phase = 'defeat';
      return true;
    }
    return false;
  }

  /** Play the defender's reply. Returns true when the run ended instead. */
  async function playDefender(): Promise<boolean> {
    // The defender only moves when the game is still running and it is not the
    // learner's turn.
    const mover = config.sideToMove(frame.truth);
    if (mover === null || mover === config.learner) return false;

    const best = frame.evaluation?.bestUci ?? null;
    if (best === null) {
      // No reply available. Stopping here is the honest failure: inventing a
      // random legal move would silently change the exercise into a different
      // one, and the learner would be graded against it.
      phase = 'defeat';
      return true;
    }
    const reply = config.fromUci(best, frame.truth);
    if (reply === null || !config.isLegal(frame.truth, reply)) {
      phase = 'defeat';
      return true;
    }
    const parent = frame.truth;
    frame = {
      truth: config.applyMove(parent, reply),
      evaluation: null,
      movesPlayed: frame.movesPlayed,
      moves: [...frame.moves, config.moveLabel(reply, parent)],
    };
    config.onMovePlayed?.(reply, parent, 'defender');
    await evaluateInto(frame);
    return false;
  }

  /** Hold the defender's reply until `minReplyDelayMs` after the learner moved. */
  async function replyPause(movedAt: number): Promise<void> {
    const remaining = (config.minReplyDelayMs ?? 0) - (Date.now() - movedAt);
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }

  async function start(): Promise<void> {
    phase = 'thinking';
    await evaluateInto(frame);
    // An exercise may open on the defender's move.
    if (config.sideToMove(frame.truth) !== config.learner) {
      if (await playDefender()) return;
    }
    if (await settle()) return;
    phase = 'play';
  }

  async function attempt(move: M): Promise<PracticeVerdict | 'invalid'> {
    if (phase !== 'play') return 'invalid';
    if (config.sideToMove(frame.truth) !== config.learner) return 'invalid';
    if (!config.isLegal(frame.truth, move)) return 'invalid';

    const before = frame;
    const winBefore =
      before.evaluation === null ? null : winPercent(before.evaluation.cp, before.evaluation.mate);

    phase = 'thinking';
    hintLevel = 0;
    frame = {
      truth: config.applyMove(before.truth, move),
      evaluation: null,
      movesPlayed: before.movesPlayed + 1,
      moves: [...before.moves, config.moveLabel(move, before.truth)],
    };
    // Announced before the search, not after it: this is the moment the learner
    // let go of the piece.
    config.onMovePlayed?.(move, before.truth, 'learner');
    const movedAt = Date.now();
    await evaluateInto(frame);
    // The grade reads an exact result on both sides of the move; the learner was
    // handed the board without waiting for the one before it, so it is awaited
    // here, after their move is already on the board.
    await Promise.all([exactSettled(before), exactSettled(frame)]);

    const winAfter =
      frame.evaluation === null ? null : winPercent(frame.evaluation.cp, frame.evaluation.mate);

    // Grade only when both sides of the comparison are real. An unknown
    // evaluation must never manufacture a verdict.
    verdict =
      winBefore === null || winAfter === null ? 'good' : practiceJudgment(winBefore, winAfter);

    // An exact result on BOTH sides of the move outranks the curve: the
    // tablebase knows whether the move kept the result, where a depth-16
    // search only estimates it.
    const exact = tablebaseGrade(before.evaluation?.exact, frame.evaluation?.exact);
    graded = exact ? 'tablebase' : 'engine';
    tablebaseOutcome = exact;

    // A move that ends the game in the learner's favour is never a failure,
    // however the curve reads it: delivering mate can look like a huge swing.
    const termination = config.termination(frame.truth, config.learner);
    if (termination === 'learner-wins') {
      verdict = 'good';
      phase = 'success';
      return verdict;
    }

    if (exact) {
      if (exact === 'throwsWin' || exact === 'loses') {
        verdict = exact === 'loses' ? 'blunder' : 'mistake';
        previous = before;
        phase = 'failed';
        return verdict;
      }
      // Kept the win or held the draw: a pass, whatever the curve made of it.
      verdict = 'good';
      if (await settle()) return verdict;
      await replyPause(movedAt);
      if (await playDefender()) return verdict;
      if (await settle()) return verdict;
      phase = 'play';
      return verdict;
    }

    // Failure is leaving the goal's RESULT CLASS, not the size of the win% drop
    // (see practiceMoveAbandonsGoal: the drop alone both fails winning moves and
    // passes losing ones). The drop verdict above stays as the learner's label.
    const abandoned =
      before.evaluation !== null &&
      frame.evaluation !== null &&
      practiceMoveAbandonsGoal(config.goal, before.evaluation, frame.evaluation);
    if (abandoned) {
      // Say it lost the win even when the number barely moved, so the label the
      // learner reads matches the fact that the attempt just ended.
      if (verdict === 'good' || verdict === 'inaccuracy') verdict = 'mistake';
      previous = before;
      phase = 'failed';
      return verdict;
    }

    // The move kept the goal, so cap the label below the failing grades: a
    // `mistake`/`blunder` badge on a move the exercise just let you play on from
    // reads as a bug, and stepping out of a forced mate into a still-won
    // position routinely produces a double-digit drop that means nothing here.
    if (verdict === 'mistake' || verdict === 'blunder') verdict = 'inaccuracy';

    if (await settle()) return verdict;

    await replyPause(movedAt);
    if (await playDefender()) return verdict;
    if (await settle()) return verdict;
    phase = 'play';
    return verdict;
  }

  function hint(): void {
    if (phase !== 'play') return;
    if (!frame.evaluation?.bestUci) return;
    hintLevel = Math.min(hintLevel + 1, 2);
  }

  function retry(): void {
    if (phase !== 'failed' || previous === null) return;
    frame = previous;
    previous = null;
    verdict = null;
    graded = null;
    tablebaseOutcome = null;
    hintLevel = 0;
    phase = 'play';
  }

  async function reset(): Promise<void> {
    frame = { truth: config.initialTruth, evaluation: null, movesPlayed: 0, moves: [] };
    previous = null;
    verdict = null;
    graded = null;
    tablebaseOutcome = null;
    hintLevel = 0;
    await start();
  }

  function view(): PracticeView {
    const best = frame.evaluation?.bestUci ?? null;
    let hintView: PracticeView['hint'] = null;
    if (hintLevel > 0 && best) {
      hintView = hintLevel === 1 ? { level: 'origin', uci: best } : { level: 'move', uci: best };
    }
    return {
      phase,
      movesPlayed: frame.movesPlayed,
      verdict,
      winPercent:
        frame.evaluation === null ? null : winPercent(frame.evaluation.cp, frame.evaluation.mate),
      awaitingMove: phase === 'play',
      moves: frame.moves,
      hint: hintView,
      graded,
      tablebase: tablebaseOutcome,
    };
  }

  return {
    truth: () => frame.truth,
    view,
    start,
    attempt,
    hint,
    retry,
    reset,
  };
}

function flipExact(result: PracticeExactResult): PracticeExactResult {
  return result === 'win' ? 'loss' : result === 'loss' ? 'win' : 'draw';
}

/**
 * The tablebase's verdict on a learner move, both sides in the learner's point
 * of view; null when either side is not exact, or when the pair is not a
 * learner's choice the table can grade (already lost before the move, or a
 * "gain" that perfect information makes impossible and so means the two
 * lookups disagree).
 */
export function tablebaseGrade(
  before: PracticeEval['exact'],
  after: PracticeEval['exact'],
): PracticeTablebaseOutcome | null {
  if (!before || !after) return null;
  if (before.result === 'win') {
    if (after.result === 'win') return 'keepsWin';
    return after.result === 'draw' ? 'throwsWin' : 'loses';
  }
  if (before.result === 'draw') {
    if (after.result === 'draw') return 'holdsDraw';
    return after.result === 'loss' ? 'loses' : null;
  }
  return null;
}
