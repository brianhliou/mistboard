// Standings computed from the broadcast's own boards, lichess-style ("Players"
// tab): the source publishes results per game and no separate table, so the
// table is derived here and says so. Same shape for a swiss, a round robin and
// a knockout; the last of these reads as "who played most and scored most",
// which is the bracket order anyway.

import type {
  XiangqiBroadcastGameDetails,
  XiangqiBroadcastPlayerTag,
  XiangqiBroadcastResult,
} from '@mistboard/game';

export type StandingsBoard = {
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  result: XiangqiBroadcastResult;
  status: 'scheduled' | 'live' | 'complete';
  /** With the table and game, what tells a playoff apart from a round game. */
  roundId?: string;
  details?: Pick<XiangqiBroadcastGameDetails, 'table' | 'game' | 'kind'>;
};

type ScoredGame = {
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  result: XiangqiBroadcastResult;
};

function points(result: XiangqiBroadcastResult, seat: 'red' | 'black'): number {
  if (result === '1/2-1/2') return 0.5;
  if (result === '1-0') return seat === 'red' ? 1 : 0;
  if (result === '0-1') return seat === 'black' ? 1 : 0;
  return 0;
}

/**
 * The games that count, one per pairing. A table that played a slow game and
 * then a rapid or blitz playoff between the same two players in one round
 * (the 2024 Asian final: 第1局 slow drawn, 第2局 rapid won) is ONE game for
 * the standings, won by whoever scored more across them; dpxq's own table
 * counts it that way (the champion: 7 games, 6 won, 1 drawn). Counting both
 * would give the finalists a game nobody else played.
 */
export function standingsGames(boards: readonly StandingsBoard[]): ScoredGame[] {
  const finished = boards.filter((board) => board.status === 'complete' && board.result !== '*');
  const tables = new Map<string, StandingsBoard[]>();
  const games: ScoredGame[] = [];
  for (const board of finished) {
    const table = board.details?.table;
    if (board.roundId === undefined || table === undefined || board.details?.game === undefined) {
      games.push(board);
      continue;
    }
    const pair = [board.red.name.trim(), board.black.name.trim()].sort().join('|');
    const key = `${board.roundId}|${table}|${pair}`;
    const list = tables.get(key) ?? [];
    list.push(board);
    tables.set(key, list);
  }
  for (const list of tables.values()) {
    const slow = list.some((board) => (board.details?.kind ?? 'standard') === 'standard');
    const playoff = list.some(
      (board) => board.details?.kind === 'rapid' || board.details?.kind === 'blitz',
    );
    if (list.length < 2 || !slow || !playoff) {
      games.push(...list);
      continue;
    }
    const first = [...list].sort((a, b) => (a.details?.game ?? 0) - (b.details?.game ?? 0))[0]!;
    const firstName = first.red.name.trim();
    let firstScore = 0;
    let otherScore = 0;
    for (const board of list) {
      const firstIsRed = board.red.name.trim() === firstName;
      firstScore += points(board.result, firstIsRed ? 'red' : 'black');
      otherScore += points(board.result, firstIsRed ? 'black' : 'red');
    }
    games.push({
      red: first.red,
      black: first.black,
      result: firstScore > otherScore ? '1-0' : firstScore < otherScore ? '0-1' : '1/2-1/2',
    });
  }
  return games;
}

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
 * A board with a result and no moves counts like any other: the result is
 * the source's, and most games of an event are published that way. A slow
 * game and its playoff count once (standingsGames).
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

  for (const board of standingsGames(boards)) {
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
