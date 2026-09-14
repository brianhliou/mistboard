// Standings computed from the broadcast's own boards, lichess-style ("Players"
// tab): the source publishes results per game and no separate table, so the
// table is derived here and says so. Same shape for a swiss, a round robin and
// a knockout; the last of these reads as "who played most and scored most",
// which is the bracket order anyway.

import type { XiangqiBroadcastPlayerTag, XiangqiBroadcastResult } from '@mistboard/game';

export type StandingsBoard = {
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  result: XiangqiBroadcastResult;
  status: 'scheduled' | 'live' | 'complete';
};

export type StandingsRow = {
  player: XiangqiBroadcastPlayerTag;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Win 1, draw ½; the sort key. */
  score: number;
};

/**
 * One row per distinct player name (the source's own spelling is the key: a
 * romanised form is a cache and two boards can carry it differently). Only
 * boards with a result count; a live or scheduled board is not a game played.
 * Sorted by score, then wins, then fewest games, then name, so a knockout's
 * finalists lead and a byed player does not outrank someone who played.
 */
export function broadcastStandings(boards: readonly StandingsBoard[]): StandingsRow[] {
  const rows = new Map<string, StandingsRow>();
  const rowFor = (player: XiangqiBroadcastPlayerTag): StandingsRow => {
    const key = player.name.trim();
    let row = rows.get(key);
    if (!row) {
      row = { player, games: 0, wins: 0, draws: 0, losses: 0, score: 0 };
      rows.set(key, row);
    } else if (!row.player.federation && player.federation) {
      // A later board may carry the team tag an earlier one lacked.
      row.player = player;
    }
    return row;
  };

  for (const board of boards) {
    if (board.status !== 'complete' || board.result === '*') continue;
    const red = rowFor(board.red);
    const black = rowFor(board.black);
    red.games += 1;
    black.games += 1;
    if (board.result === '1-0') {
      red.wins += 1;
      red.score += 1;
      black.losses += 1;
    } else if (board.result === '0-1') {
      black.wins += 1;
      black.score += 1;
      red.losses += 1;
    } else {
      red.draws += 1;
      black.draws += 1;
      red.score += 0.5;
      black.score += 0.5;
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.wins - a.wins ||
      a.games - b.games ||
      a.player.name.localeCompare(b.player.name, 'zh'),
  );
}

/** "3", "2½", "½", "0": the score as a player would write it. */
export function formatStandingsScore(score: number): string {
  const whole = Math.floor(score);
  const half = score - whole >= 0.5;
  if (whole === 0 && half) return '½';
  return `${whole}${half ? '½' : ''}`;
}
