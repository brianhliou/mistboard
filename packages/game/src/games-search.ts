// The /games/search contract shared by the route that answers it and the page
// that builds its form (apps/server routes/historical-xiangqi-games.ts, apps/web
// historical-xiangqi-search.ts), which cannot import each other.

/**
 * The default minimum game length for games played on the site, in plies,
 * applied when a search does not set one (`plyMin` absent).
 *
 * Measured on mistboard.com, 2026-10-01: 362 of 1,845 public games played here
 * (20%) ended before ply 10, 204 of them within two plies; they are games
 * abandoned in the opening, mostly a guest against a bot. Ten plies is five
 * moves a side, the shortest game that has left the opening. Broadcasts and the
 * archive are not floored: none of their games is that short, and a floor high
 * enough to matter there would hide real agreed draws (the shortest broadcast
 * games are 12- and 16-ply draws). A search that sets `plyMin`, including 0,
 * gets exactly that minimum on every source.
 */
export const GAMES_SEARCH_DEFAULT_MIN_PLIES = 10;
