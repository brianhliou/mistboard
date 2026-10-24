// Offline scoring only: no persistence, replay, engine execution or public payloads.
import { moveJudgment, winPercent, winPercentK } from '@mistboard/game';

type Side = 'red' | 'black';
type Evaluation = {
  ply: number;
  cp: number | null;
  mate: number | null;
  best: string | null;
  unstable: boolean;
};
type FixtureGame = {
  gameId: string;
  engineId: string;
  firstMover: Side;
  moves: string[];
  plies: Map<number, Evaluation>;
  chancePlies: Set<number>;
};

export type RankedBlunder = {
  gameId: string;
  engineId: string;
  /** One-based ply of the move, not the position before it. */
  ply: number;
  mover: Side;
  move: string;
  bestMove: string | null;
  /** Win-chance percentages from the MOVER's POV, on the engine's own curve. */
  winBefore: number;
  winAfter: number;
  winLoss: number;
};
export type SkippedMove = {
  gameId: string;
  ply: number;
  reason: 'chance-move' | 'missing-evaluation' | 'unstable-evaluation' | 'best-played';
};
export type BlunderRanking = {
  totalBlunders: number;
  blunders: RankedBlunder[];
  skipped: SkippedMove[];
};

/**
 * Rank supplied scores by lost winning chances using the review's 15-point
 * blunder threshold. Both scores must be Red POV; Black's chances are complemented.
 * Missing, unstable and chance evaluations cannot establish a player's error.
 * A played engine best move cannot be its own engine's blunder either.
 */
export function rankBlunders(fixture: unknown, limit = 20): BlunderRanking {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('limit must be a positive integer');
  const games = parseFixture(fixture);
  const blunders: RankedBlunder[] = [];
  const skipped: SkippedMove[] = [];
  for (const game of games) {
    const k = winPercentK(game.engineId);
    for (const [index, move] of game.moves.entries()) {
      const ply = index + 1;
      const before = game.plies.get(ply - 1);
      const after = game.plies.get(ply);
      let reason: SkippedMove['reason'] | undefined;
      if (game.chancePlies.has(ply)) reason = 'chance-move';
      else if (!hasScore(before) || !hasScore(after)) reason = 'missing-evaluation';
      else if (before.unstable || after.unstable) reason = 'unstable-evaluation';
      else if (before.best === move) reason = 'best-played';
      if (reason) {
        skipped.push({ gameId: game.gameId, ply, reason });
        continue;
      }
      // The missing-evaluation branch above excluded absent rows.
      const redBefore = winPercent(before!.cp, before!.mate, k);
      const redAfter = winPercent(after!.cp, after!.mate, k);
      const mover = index % 2 === 0 ? game.firstMover : opposite(game.firstMover);
      const winBefore = mover === 'red' ? redBefore : 100 - redBefore;
      const winAfter = mover === 'red' ? redAfter : 100 - redAfter;
      if (moveJudgment(winBefore, winAfter) !== 'blunder') continue;
      blunders.push({
        gameId: game.gameId,
        engineId: game.engineId,
        ply,
        mover,
        move,
        bestMove: before!.best,
        winBefore,
        winAfter,
        winLoss: winBefore - winAfter,
      });
    }
  }
  blunders.sort((a, b) => b.winLoss - a.winLoss || compareMove(a, b));
  skipped.sort(compareMove);
  return { totalBlunders: blunders.length, blunders: blunders.slice(0, limit), skipped };
}

function hasScore(value: Evaluation | undefined): value is Evaluation {
  return value !== undefined && (value.cp !== null || value.mate !== null);
}

function opposite(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}

function compareMove(
  a: { gameId: string; ply: number },
  b: { gameId: string; ply: number },
): number {
  // Code-unit ordering is independent of the host's locale and input order.
  return a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : a.ply - b.ply;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function plyNumber(value: unknown, max: number, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

function score(value: unknown, label: string, integer = false): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new Error(`${label} must be ${integer ? 'an integer' : 'finite'} or null`);
  }
  return value;
}

function parseFixture(value: unknown): FixtureGame[] {
  const fixture = object(value, 'fixture');
  if (fixture.version !== 1) throw new Error('fixture.version must be 1');
  if (fixture.scorePov !== 'red') throw new Error('fixture.scorePov must be red');
  const ids = new Set<string>();
  return array(fixture.games, 'fixture.games').map((value, index) => {
    const label = `games[${index}]`;
    const game = object(value, label);
    const gameId = text(game.gameId, `${label}.gameId`);
    if (ids.has(gameId)) throw new Error(`duplicate gameId: ${gameId}`);
    ids.add(gameId);
    const engineId = text(game.engineId, `${label}.engineId`);
    if (game.firstMover !== 'red' && game.firstMover !== 'black') {
      throw new Error(`${label}.firstMover must be red or black`);
    }
    const moves = array(game.moves, `${label}.moves`).map((move, i) =>
      text(move, `${label}.moves[${i}]`),
    );
    const plies = new Map<number, Evaluation>();
    for (const [i, value] of array(game.plies, `${label}.plies`).entries()) {
      const rowLabel = `${label}.plies[${i}]`;
      const row = object(value, rowLabel);
      const ply = plyNumber(row.ply, moves.length, `${rowLabel}.ply`);
      if (plies.has(ply)) throw new Error(`${label}: duplicate ply ${ply}`);
      const cp = score(row.cp, `${rowLabel}.cp`);
      const mate = score(row.mate, `${rowLabel}.mate`, true);
      if (cp !== null && mate !== null) throw new Error(`${rowLabel}: cp and mate are both set`);
      if (row.unstable !== undefined && typeof row.unstable !== 'boolean') {
        throw new Error(`${rowLabel}.unstable must be boolean`);
      }
      plies.set(ply, {
        ply,
        cp,
        mate,
        best: row.best == null ? null : text(row.best, `${rowLabel}.best`),
        unstable: row.unstable === true,
      });
    }
    const chancePlies = new Set(
      array(game.chancePlies ?? [], `${label}.chancePlies`).map((ply) =>
        plyNumber(ply, moves.length, `${label}.chancePlies`, 1),
      ),
    );
    return { gameId, engineId, firstMover: game.firstMover, moves, plies, chancePlies };
  });
}
