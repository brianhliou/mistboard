// Where a player with no puzzle history starts (#712). Both the queue's
// target on the page and the server's first rating row read this, so a new
// player is served and rated from the same number.
//
// 1800, not the Glicko default 1500: 72% of the pool is a 3-ply line and the
// queue matched new players to its easiest third, so the first puzzles anyone
// saw were the ones regulars called too easy. Starting higher lets the rating
// fall to a weak player in a few misses instead of climbing for dozens of
// solves. The rating deviation stays at the default, so it still moves fast.
export const PUZZLE_NEW_PLAYER_RATING = 1800;

export type PuzzleDashboardResults = {
  nb: number;
  wins: number;
  fixed: number;
  puzzleRatingAvg: number | null;
};

/** Pure dashboard arithmetic shared by the API and browser. */
export function puzzleDashboardMetrics(results: PuzzleDashboardResults): {
  firstWins: number;
  unfixed: number;
  failed: number;
  performance: number | null;
  clear: boolean;
} {
  const firstWins = results.wins - results.fixed;
  const unfixed = results.nb - results.wins;
  const failed = results.fixed + unfixed;
  return {
    firstWins,
    unfixed,
    failed,
    performance:
      results.nb === 0 || results.puzzleRatingAvg === null
        ? null
        : Math.round(results.puzzleRatingAvg - 500 + (1000 * firstWins) / results.nb),
    clear: results.nb >= 6 && firstWins >= 2 && failed >= 2,
  };
}
