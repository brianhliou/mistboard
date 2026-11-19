// Descriptive evidence only: no flags, thresholds for sanctions or engine work.
import type { StoredPlyEval } from './persistence-game-analysis.js';
import type { RatingTimeClass } from './rating-buckets.js';

export const FAIR_PLAY_ANALYZED_GAME_LIMIT = 40;

export type FairPlayMove = {
  color: string;
  uci: string;
  legalMoves: readonly string[];
};

export type FairPlaySummaryGame = {
  roomId: string;
  variant: string;
  timeClass: RatingTimeClass | null;
  rating: number | null;
  playerColor: string;
  endedAt: string;
  engineId: string | null;
  depth: number | null;
  analysis: readonly StoredPlyEval[] | null;
  moves: readonly FairPlayMove[] | null;
};

function emptyTotals() {
  return {
    topMoveMatch: { matches: 0, samples: 0, rate: null as number | null },
    averageLoss: { totalCp: 0, samples: 0, cp: null as number | null },
    skipped: { opening: 0, forced: 0, decided: 0, unavailable: 0 },
  };
}

type Totals = ReturnType<typeof emptyTotals>;

function finish(totals: Totals): Totals {
  const { topMoveMatch: match, averageLoss: loss } = totals;
  match.rate = match.samples ? match.matches / match.samples : null;
  loss.cp = loss.samples ? loss.totalCp / loss.samples : null;
  return totals;
}

function add(target: Totals, source: Totals): void {
  target.topMoveMatch.matches += source.topMoveMatch.matches;
  target.topMoveMatch.samples += source.topMoveMatch.samples;
  target.averageLoss.totalCp += source.averageLoss.totalCp;
  target.averageLoss.samples += source.averageLoss.samples;
  for (const key of ['opening', 'forced', 'decided', 'unavailable'] as const) {
    target.skipped[key] += source.skipped[key];
  }
}

/** One move can lose at most this much on the summary's scale. Evals are
 * clamped to it and a mate counts as it, so a single blunder into mate (or a
 * swing between two won positions) cannot swamp an account's average loss. */
export const FAIR_PLAY_SCORE_CAP_CP = 1000;

function score(row: StoredPlyEval | undefined): number | null {
  if (!row || row.unstable) return null;
  // The pre-move mate is excluded as decided. A move INTO mate lands on the cap.
  if (row.mate !== null && Number.isFinite(row.mate)) {
    return row.mate >= 0 ? FAIR_PLAY_SCORE_CAP_CP : -FAIR_PLAY_SCORE_CAP_CP;
  }
  if (row.cp === null || !Number.isFinite(row.cp)) return null;
  return Math.max(-FAIR_PLAY_SCORE_CAP_CP, Math.min(FAIR_PLAY_SCORE_CAP_CP, row.cp));
}

export function summarizeFairPlayGame(game: FairPlaySummaryGame) {
  const account = emptyTotals();
  const opponents = emptyTotals();
  const analysisStatus = !game.analysis ? 'missing' : !game.moves ? 'unavailable' : 'ready';
  if (game.analysis && game.moves) {
    const byPly = new Map(game.analysis.map((row) => [row.ply, row]));
    game.moves.forEach((move, index) => {
      const totals = move.color === game.playerColor ? account : opponents;
      const before = byPly.get(index);
      const after = byPly.get(index + 1);
      if (index < 10) {
        totals.skipped.opening++;
      } else if (move.legalMoves.length <= 1) {
        totals.skipped.forced++;
      } else if (
        before &&
        (before.mate !== null || (before.cp !== null && Math.abs(before.cp) >= 500))
      ) {
        totals.skipped.decided++;
      } else if (score(before) === null || before?.unstable || after?.unstable) {
        totals.skipped.unavailable++;
      } else {
        if (before?.best && move.legalMoves.includes(before.best)) {
          totals.topMoveMatch.samples++;
          if (move.uci === before.best) totals.topMoveMatch.matches++;
        }
        const afterScore = score(after);
        if (afterScore !== null) {
          // Flip-game tracks stay Red SEAT POV even when that seat binds
          // black pieces. Fog is White POV; Gomoku is Black POV.
          const positiveColor =
            game.variant === 'gomoku' ? 'black' : game.variant === 'dark-chess' ? 'white' : 'red';
          const sign = move.color === positiveColor ? 1 : -1;
          const loss =
            move.uci === before?.best ? 0 : Math.max(0, sign * (score(before)! - afterScore));
          totals.averageLoss.samples++;
          totals.averageLoss.totalCp += loss;
        }
      }
    });
  }
  return {
    roomId: game.roomId,
    variant: game.variant,
    timeClass: game.timeClass,
    endedAt: game.endedAt,
    engineId: game.engineId,
    depth: game.depth,
    analysisStatus,
    account: finish(account),
    opponents: finish(opponents),
  };
}

export function summarizeFairPlayAccount(
  accountId: string,
  inputs: readonly FairPlaySummaryGame[],
) {
  const games = inputs.map(summarizeFairPlayGame);
  const account = emptyTotals();
  const opponents = emptyTotals();
  const groups = new Map<
    string,
    {
      variant: string;
      timeClass: RatingTimeClass | null;
      rating: number | null;
      games: number;
      analyzedGames: number;
      missingAnalysisGames: number;
      account: Totals;
      opponents: Totals;
    }
  >();
  for (const [index, game] of games.entries()) {
    const key = JSON.stringify([game.variant, game.timeClass]);
    let group = groups.get(key);
    if (!group) {
      group = {
        variant: game.variant,
        timeClass: game.timeClass,
        rating: inputs[index]!.rating,
        games: 0,
        analyzedGames: 0,
        missingAnalysisGames: 0,
        account: emptyTotals(),
        opponents: emptyTotals(),
      };
      groups.set(key, group);
    }
    group.games++;
    if (game.analysisStatus === 'missing') group.missingAnalysisGames++;
    else group.analyzedGames++;
    add(group.account, game.account);
    add(group.opponents, game.opponents);
    add(account, game.account);
    add(opponents, game.opponents);
  }
  return {
    accountId,
    analyzedGameLimit: FAIR_PLAY_ANALYZED_GAME_LIMIT,
    gamesConsidered: games.length,
    analyzedGames: games.filter((game) => game.analysisStatus !== 'missing').length,
    missingAnalysisGameCount: games.filter((game) => game.analysisStatus === 'missing').length,
    missingAnalysisGames: games
      .filter((game) => game.analysisStatus === 'missing')
      .map((game) => game.roomId),
    unavailableGames: games
      .filter((game) => game.analysisStatus === 'unavailable')
      .map((game) => game.roomId),
    account: finish(account),
    opponents: finish(opponents),
    groups: [...groups.values()].map((group) => ({
      ...group,
      account: finish(group.account),
      opponents: finish(group.opponents),
    })),
    games,
  };
}
