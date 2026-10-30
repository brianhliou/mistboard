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
