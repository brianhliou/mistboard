// What a game teaches, read off its eval series. Pure functions over the stored
// analysis (Red-POV evals per position, moves in our squares) so the ranker and
// the annotator agree on every number and a test can pin them without an engine.
//
// A "moment" is a judged move: the mover gave up win probability by lila's
// thresholds (5/10/15 points). A model game is one the winner played cleanly and
// the loser lost in one or two identifiable places; a decisive moment is the
// loser's single largest give-away while the game was still open.

import {
  gameAccuracy,
  type MoveJudgment,
  moveJudgment,
  winPercent,
  type XiangqiColor,
} from '@mistboard/game';

/** The stored analysis row, after the route converted engine UCI to our squares. */
export type CuratorPlyEval = {
  ply: number;
  cp: number | null;
  mate: number | null;
  best: string | null;
  pv?: string[];
  second?: { move: string; cp: number | null; mate: number | null };
};

export type PlyVerdict = {
  /** 1-based ply of the move. */
  ply: number;
  mover: XiangqiColor;
  /** Mover-POV win% before and after the move. */
  winBefore: number;
  winAfter: number;
  /** Win% points given up (0 when the move held or improved). */
  drop: number;
  judgment: MoveJudgment;
  /** Engine best from the position before the move, our uci ("h3e3"). */
  best: string | null;
  pv: string[];
  playedBest: boolean;
  /** Red-POV eval after the move, for comment text. */
  cpAfter: number | null;
  mateAfter: number | null;
};

export type GameVerdicts = {
  verdicts: PlyVerdict[];
  accuracy: { red: number; black: number };
};

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export function winnerOf(result: GameResult): XiangqiColor | null {
  return result === '1-0' ? 'red' : result === '0-1' ? 'black' : null;
}

export function loserOf(result: GameResult): XiangqiColor | null {
  return result === '1-0' ? 'black' : result === '0-1' ? 'red' : null;
}

function moverPov(redWin: number, mover: XiangqiColor): number {
  return mover === 'red' ? redWin : 100 - redWin;
}

/** Judge every move of the game. `moves` are the game's moves as our uci
 *  strings; `evals` has one row per position (0..N). Missing rows judge nothing. */
export function judgeGame(
  moves: readonly string[],
  evals: readonly CuratorPlyEval[],
): GameVerdicts {
  const byPly = new Map(evals.map((row) => [row.ply, row]));
  const redWins: number[] = [];
  for (let ply = 0; ply <= moves.length; ply += 1) {
    const row = byPly.get(ply);
    redWins.push(row ? winPercent(row.cp, row.mate) : 50);
  }
  const verdicts: PlyVerdict[] = [];
  moves.forEach((move, index) => {
    const ply = index + 1;
    const before = byPly.get(ply - 1);
    const after = byPly.get(ply);
    if (!before || !after) return;
    const mover: XiangqiColor = ply % 2 === 1 ? 'red' : 'black';
    const winBefore = moverPov(redWins[ply - 1] ?? 50, mover);
    const winAfter = moverPov(redWins[ply] ?? 50, mover);
    const drop = Math.max(0, winBefore - winAfter);
    verdicts.push({
      ply,
      mover,
      winBefore,
      winAfter,
      drop,
      judgment: moveJudgment(winBefore, winAfter),
      best: before.best,
      pv: before.pv ?? [],
      playedBest: before.best === move,
      cpAfter: after.cp,
      mateAfter: after.mate,
    });
  });
  const accuracy = gameAccuracy(redWins);
  return { verdicts, accuracy: { red: accuracy.first, black: accuracy.second } };
}

export type ModelGameScore = {
  score: number;
  winnerAccuracy: number;
  /** Share of the loser's total give-away that sits in their two worst moves. */
  clarity: number;
  winnerJudged: number;
};

/**
 * How well a decisive game serves as a model: the winner's accuracy carries
 * half the weight, the loser losing in one or two places (rather than bleeding
 * everywhere) carries most of the rest, and a winner with no judged move at
 * all gets a bonus. Null for a drawn or unfinished game.
 */
export function scoreModelGame(result: GameResult, game: GameVerdicts): ModelGameScore | null {
  const winner = winnerOf(result);
  const loser = loserOf(result);
  if (!winner || !loser) return null;
  const winnerAccuracy = game.accuracy[winner];
  const loserDrops = game.verdicts
    .filter((v) => v.mover === loser && v.judgment)
    .map((v) => v.drop)
    .sort((a, b) => b - a);
  const total = loserDrops.reduce((sum, d) => sum + d, 0);
  const topTwo = (loserDrops[0] ?? 0) + (loserDrops[1] ?? 0);
  // A loser who never gave anything up by the thresholds has no lesson in the
  // game for the reader; that is a well-played draw-ish loss, not a model.
  const clarity = total > 0 ? topTwo / total : 0;
  const winnerJudged = game.verdicts.filter((v) => v.mover === winner && v.judgment).length;
  const winnerBlunders = game.verdicts.filter(
    (v) => v.mover === winner && (v.judgment === 'blunder' || v.judgment === 'mistake'),
  ).length;
  const cleanBonus = winnerJudged === 0 ? 10 : winnerBlunders === 0 ? 5 : 0;
  const score = total > 0 ? winnerAccuracy * 0.5 + clarity * 40 + cleanBonus : 0;
  return { score, winnerAccuracy, clarity, winnerJudged };
}

export type DecisiveMoment = {
  verdict: PlyVerdict;
  score: number;
};

/** Minimum mover-POV win% before the move for it to count as still open. */
export const DECISIVE_OPEN_FLOOR = 35;

/**
 * The loser's largest give-away while the game was still open, with a usable
 * engine answer (a best move and a line) so it can be played as a gamebook.
 * A blunder in a lost position is not decisive; it is the end of a game that
 * was already decided.
 */
export function findDecisiveMoment(result: GameResult, game: GameVerdicts): DecisiveMoment | null {
  const loser = loserOf(result);
  if (!loser) return null;
  let best: DecisiveMoment | null = null;
  for (const verdict of game.verdicts) {
    if (verdict.mover !== loser || !verdict.judgment) continue;
    if (verdict.winBefore < DECISIVE_OPEN_FLOOR) continue;
    if (!verdict.best || verdict.pv.length === 0) continue;
    // Closer to level before the move reads as a truer turning point.
    const openness = 1 - Math.abs(verdict.winBefore - 50) / 50;
    const score = verdict.drop + openness * 10;
    if (!best || score > best.score) best = { verdict, score };
  }
  return best;
}

/** The judged moves worth a comment, hardest give-away first, capped. */
export function topMoments(game: GameVerdicts, max: number): PlyVerdict[] {
  return game.verdicts
    .filter((v) => v.judgment)
    .sort((a, b) => b.drop - a.drop)
    .slice(0, max)
    .sort((a, b) => a.ply - b.ply);
}
