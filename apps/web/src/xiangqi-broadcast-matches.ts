// A team league round, read as the league plays it. The 2026 men's league
// round is a set of team matches (北京-江苏); each match has four tables, and
// each table plays a slow game (40+20) and then a blitz game (5+3) with the
// colours swapped. Both count. The source states all of this per game
// (board.details), and a flat grid of it read as the same pairings listed
// twice plus a "Board 73".
//
// Scoring is the league's own, from its 规程 as dpxq reproduces it (tour
// 12683): a game scores 2 for a win and 1 for a draw (个人局分), a match 3 for a
// win and 1.5 for a draw (团体场分), and teams rank by match points, then total
// game points, then slow-game points, then slow-game wins. The women's league
// uses the same 规程 family; an event scored differently needs its own rules.
//
// A team is the affiliation on the player tag (`federation`), the name the
// cards already show. The match's own name uses short forms (北京, 江苏) that do
// not always prefix the affiliation (a 江苏 side plays as 常熟文旅酒店), so the
// match name orders the two sides where it can and the games decide the rest.

import type {
  XiangqiBroadcastGameDetails,
  XiangqiBroadcastPlayerTag,
  XiangqiBroadcastResult,
} from '@mistboard/game';

export type MatchBoard = {
  id: string;
  boardNumber: number;
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  result: XiangqiBroadcastResult;
  status: 'scheduled' | 'live' | 'complete';
  details?: XiangqiBroadcastGameDetails;
};

export type MatchTeam = { name: string; nameEn?: string };

export type MatchSegment<B extends MatchBoard> = {
  boards: B[];
  /** Game points per side, the league's 2 for a win and 1 for a draw,
   *  finished games only. */
  score: [number, number];
  /** Wins per side. */
  wins: [number, number];
};

export type TeamMatch<B extends MatchBoard> = {
  key: string;
  /** The source's match name, "北京-江苏", and its English form. */
  name: string;
  nameEn?: string;
  /** The two sides, in the match name's order where the names allow it. */
  teams: [MatchTeam, MatchTeam];
  /** Slow games (standard or rapid). */
  slow: MatchSegment<B>;
  /** Blitz games, the second game at each table. */
  blitz: MatchSegment<B>;
  /** Game points over every game of the match. */
  score: [number, number];
  /** Index into `teams` of the winner once every game is in; null while
   *  games remain or when the match is drawn. */
  winner: 0 | 1 | null;
  /** No game still to finish. */
  finished: boolean;
  /** Every table has both its games: a table with a slow game and no blitz
   *  game (or the reverse) means the source is missing a record, and the
   *  score is short. Such a match stays out of the standings. */
  complete: boolean;
};

export type RoundByMatch<B extends MatchBoard> = {
  matches: TeamMatch<B>[];
  /** Boards the source filed under no match (or with no team on a side). */
  other: B[];
};

/** A round grouped by team match, or null when no board names a match (an
 *  individual event keeps its plain grid). */
export function groupRoundByMatch<B extends MatchBoard>(
  boards: readonly B[],
): RoundByMatch<B> | null {
  if (!boards.some((board) => board.details?.match)) return null;
  const byMatch = new Map<string, B[]>();
  const other: B[] = [];
  for (const board of boards) {
    const name = board.details?.match;
    if (!name || !board.red.federation || !board.black.federation) {
      other.push(board);
      continue;
    }
    const list = byMatch.get(name) ?? [];
    list.push(board);
    byMatch.set(name, list);
  }

  const matches: TeamMatch<B>[] = [];
  for (const [name, list] of byMatch) {
    const teams = matchTeams(name, list);
    if (!teams) {
      other.push(...list);
      continue;
    }
    const sorted = [...list].sort(compareInMatch);
    const slow = segment(
      sorted.filter((board) => board.details?.kind !== 'blitz'),
      teams,
    );
    const blitz = segment(
      sorted.filter((board) => board.details?.kind === 'blitz'),
      teams,
    );
    const score: [number, number] = [
      slow.score[0] + blitz.score[0],
      slow.score[1] + blitz.score[1],
    ];
    const finished = sorted.every((board) => board.status === 'complete');
    const complete =
      finished && (blitz.boards.length === 0 || blitz.boards.length === slow.boards.length);
    const winner = complete && score[0] !== score[1] ? (score[0] > score[1] ? 0 : 1) : null;
    matches.push({
      key: name,
      name,
      ...(list[0]?.details?.matchEn ? { nameEn: list[0].details.matchEn } : {}),
      teams,
      slow,
      blitz,
      score,
      winner,
      finished,
      complete,
    });
  }
  // The source's own order: the match whose lowest board number comes first.
  matches.sort(
    (a, b) => lowestBoardNumber(a) - lowestBoardNumber(b) || a.name.localeCompare(b.name),
  );
  return { matches, other };
}

export type TeamStandingsRow = {
  team: MatchTeam;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  /** 团体场分: 3 a win, 1.5 a draw. */
  matchPoints: number;
  /** 总局分: every game, 2 a win, 1 a draw. */
  gamePoints: number;
  /** 慢棋总局分 and 慢棋总胜局, the last two tiebreaks. */
  slowGamePoints: number;
  slowWins: number;
};

/** League table from finished matches, ranked the way the 规程 ranks it. */
export function teamStandings(boards: readonly MatchBoard[]): TeamStandingsRow[] {
  const rows = new Map<string, TeamStandingsRow>();
  const rowFor = (team: MatchTeam): TeamStandingsRow => {
    let row = rows.get(team.name);
    if (!row) {
      row = {
        team,
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        matchPoints: 0,
        gamePoints: 0,
        slowGamePoints: 0,
        slowWins: 0,
      };
      rows.set(team.name, row);
    }
    return row;
  };
  // A match name repeats across rounds (a double round robin meets twice), so
  // group per round before grouping per match.
  const byRound = new Map<string, MatchBoard[]>();
  for (const board of boards) {
    const round = (board as { roundId?: string }).roundId ?? '';
    const list = byRound.get(round) ?? [];
    list.push(board);
    byRound.set(round, list);
  }
  for (const list of byRound.values()) {
    for (const match of groupRoundByMatch(list)?.matches ?? []) {
      if (!match.complete) continue;
      const sides = match.teams.map(rowFor) as [TeamStandingsRow, TeamStandingsRow];
      sides.forEach((row, index) => {
        row.matches += 1;
        row.gamePoints += match.score[index]!;
        row.slowGamePoints += match.slow.score[index]!;
        row.slowWins += match.slow.wins[index]!;
        if (match.winner === null) {
          row.draws += 1;
          row.matchPoints += MATCH_DRAW_POINTS;
        } else if (match.winner === index) {
          row.wins += 1;
          row.matchPoints += MATCH_WIN_POINTS;
        } else {
          row.losses += 1;
        }
      });
    }
  }
  return [...rows.values()].sort(
    (x, y) =>
      y.matchPoints - x.matchPoints ||
      y.gamePoints - x.gamePoints ||
      y.slowGamePoints - x.slowGamePoints ||
      y.slowWins - x.slowWins ||
      x.team.name.localeCompare(y.team.name),
  );
}

// The 2026 league's 规程: 团体场分 胜3 和1.5 负0, 个人局分 胜2 和1 负0.
const MATCH_WIN_POINTS = 3;
const MATCH_DRAW_POINTS = 1.5;
const GAME_WIN_POINTS = 2;
const GAME_DRAW_POINTS = 1;

function compareInMatch(a: MatchBoard, b: MatchBoard): number {
  const kind = (board: MatchBoard) => (board.details?.kind === 'blitz' ? 1 : 0);
  return (
    kind(a) - kind(b) ||
    (a.details?.table ?? 99) - (b.details?.table ?? 99) ||
    (a.details?.game ?? 99) - (b.details?.game ?? 99) ||
    a.boardNumber - b.boardNumber
  );
}

function lowestBoardNumber(match: TeamMatch<MatchBoard>): number {
  return Math.min(
    ...[...match.slow.boards, ...match.blitz.boards].map((board) => board.boardNumber),
  );
}

function teamOf(player: XiangqiBroadcastPlayerTag): MatchTeam {
  return {
    name: player.federation as string,
    ...(player.federationEn ? { nameEn: player.federationEn } : {}),
  };
}

/** The two sides of a match, or null when its games name more or fewer than
 *  two teams (a mislabelled game; better ungrouped than scored wrong). */
function matchTeams(name: string, boards: readonly MatchBoard[]): [MatchTeam, MatchTeam] | null {
  const teams = new Map<string, MatchTeam>();
  for (const board of boards) {
    for (const team of [teamOf(board.red), teamOf(board.black)]) teams.set(team.name, team);
  }
  if (teams.size !== 2) return null;
  const [first, second] = [...teams.values()] as [MatchTeam, MatchTeam];
  const sides = name.split('-').map((side) => side.trim());
  const leadsWith = (team: MatchTeam, side: string | undefined) =>
    Boolean(side) && team.name.startsWith(side as string);
  // Put the side the match name lists first on the left when either name says so.
  if (leadsWith(second, sides[0]) || leadsWith(first, sides[1])) return [second, first];
  return [first, second];
}

function segment<B extends MatchBoard>(
  boards: B[],
  teams: [MatchTeam, MatchTeam],
): MatchSegment<B> {
  const score: [number, number] = [0, 0];
  const wins: [number, number] = [0, 0];
  for (const board of boards) {
    if (board.status !== 'complete' || board.result === '*') continue;
    const redSide = board.red.federation === teams[0].name ? 0 : 1;
    const blackSide = redSide === 0 ? 1 : 0;
    if (board.result === '1-0') {
      score[redSide] += GAME_WIN_POINTS;
      wins[redSide] += 1;
    } else if (board.result === '0-1') {
      score[blackSide] += GAME_WIN_POINTS;
      wins[blackSide] += 1;
    } else {
      score[0] += GAME_DRAW_POINTS;
      score[1] += GAME_DRAW_POINTS;
    }
  }
  return { boards, score, wins };
}

/** Points with a half as "½": 1.5 match points read "1½". */
export function formatPoints(points: number): string {
  const whole = Math.floor(points);
  if (points - whole < 0.5) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}
