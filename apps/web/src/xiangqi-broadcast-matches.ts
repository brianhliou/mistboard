// A team league round, read as the league plays it. The 2026 men's league
// round is a set of team matches (北京-江苏) of four tables. Each table plays a
// slow game (40+20); only if it is drawn do the two play a blitz playoff (5+3)
// with the colours swapped, and a drawn playoff leaves the table drawn. A
// match level on points after its tables is decided by one more blitz game
// between a player from each team (the source files it as a fifth table).
// Source: the new-season report (news.qq.com, 2026-09-15): "当一台次双方棋手在
// 慢棋比赛中出现和局时，则换先马上进行超快棋加赛，如加赛再获和局，则计该台次为和
// 局" and "两边棋手若战成积分相同，则各派遣1名棋手再进行一台超快棋加赛，以决定当轮
// 次团体胜负归属". Every round's data agrees: 31 of 31 decisive slow games have no
// blitz game, 85 of 87 drawn ones do. Until 2026-09-23 this module scored the
// slow and blitz games as two games that both count, which marked every match
// with a decisive slow game as missing a record and miscounted the rest.
//
// Scoring is the league's own, from its 规程 as dpxq reproduces it (tour
// 12683): a table scores 2 for a win and 1 for a draw (个人局分), a match 3 for
// a win and 1.5 for a draw (团体场分), and teams rank by match points, then total
// game points, then slow-game points, then slow-game wins. The rules say the
// deciding game settles a level match but not what a drawn one means. The
// official table counts it a drawn match (Zhejiang's 13.5 after round 5, on
// sohu.com 2026-09-16, includes one; the drawn game won by Black would make it
// 15), so it is scored a draw and the line says the decider was drawn.
//
// The 2026 women's league plays it differently (its 规程 and 补充规定 on dpxq,
// tour 12776, news 26005): three tables, one slow game each and no playoff at
// a table, so a drawn table is a draw. Higher slow total takes the match 3-0;
// a level match goes to one blitz game between the drawn tables' players
// ("两队慢棋阶段总分战平，由两队和棋台次的运动员进行快棋加赛"), won 2-1 and
// drawn 1.5 each. Teams rank by match points, then slow-game points, then
// slow-game wins; the playoff counts for neither.
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

/** Which rules a match is scored by: the 2026 men's league's (a table's slow
 *  game or its blitz playoff, a deciding game, match points 3/1.5/0), the
 *  women's league's (slow games only, a level match's playoff won 2-1), or a
 *  team championship's (one slow game a table, match points 2/1/0). */
export type MatchFormat = 'league' | 'womens-league' | 'championship';

/** The rules a league event's named matches follow; a championship is told
 *  apart by its data (no match names), not by this. 'individual' is an
 *  individual championship (个人赛), whose games carry a section tag (男子组)
 *  and federations but form no team matches. */
export type LeagueRules = 'league' | 'womens-league' | 'individual';

/** Individual events by name, the women's league's rules for its own
 *  events, the men's otherwise. */
export function leagueRulesFor(tour: { name: string } | null | undefined): LeagueRules {
  if (tour && /个人|個人/.test(tour.name)) return 'individual';
  return tour && /女子甲级联赛|女子甲級聯賽/.test(tour.name) ? 'womens-league' : 'league';
}

export type TeamMatch<B extends MatchBoard> = {
  format: MatchFormat;
  key: string;
  /** The source's match name, "北京-江苏", and its English form. */
  name: string;
  nameEn?: string;
  /** The two sides, in the match name's order where the names allow it. */
  teams: [MatchTeam, MatchTeam];
  /** Slow games (standard or rapid); their points are the 慢棋 tiebreaks. */
  slow: MatchSegment<B>;
  /** Blitz playoffs, played at a table whose slow game was drawn. */
  blitz: MatchSegment<B>;
  /** The blitz game that decides a match level after its tables. */
  decider: B | null;
  /** Table points: each table's result (the slow game, else its playoff), 2
   *  a win and 1 a draw. */
  score: [number, number];
  /** Index into `teams` of the winner once every game is in; null while
   *  games remain, when the match is drawn, or when a record is missing. */
  winner: 0 | 1 | null;
  /** The deciding game was drawn: the rules do not say who takes the match,
   *  so it stands as a draw. */
  deciderDrawn: boolean;
  /** The match went to the playoff and its winner took it 2-1 (the women's
   *  league); false for a match won on the slow games. */
  wonOnPlayoff: boolean;
  /** No game still to finish. */
  finished: boolean;
  /** Every table has its result: a drawn slow game with no playoff, or a
   *  level match with no deciding game, means the source is missing a
   *  record. Such a match stays out of the standings. */
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
  rules: LeagueRules = 'league',
): RoundByMatch<B> | null {
  // The 2024 Asian individual championship's records carry 男子组 and each
  // player's federation, which read as a team championship's section and
  // teams: every China-Vietnam game became a "match".
  if (rules === 'individual') return null;
  if (!boards.some((board) => isMatchName(board.details?.match))) {
    return groupChampionshipRound(boards);
  }
  const byMatch = new Map<string, B[]>();
  const other: B[] = [];
  for (const board of boards) {
    const name = board.details?.match;
    if (!isMatchName(name) || !board.red.federation || !board.black.federation) {
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
    if (rules === 'womens-league') {
      matches.push(womensLeagueMatch(name, sorted, teams));
      continue;
    }
    const slowBoards = sorted.filter((board) => board.details?.kind !== 'blitz');
    const slowTables = new Set(slowBoards.map((board) => board.details?.table));
    const blitzBoards = sorted.filter((board) => board.details?.kind === 'blitz');
    // The source numbers a table's playoff game 2 and files the deciding game
    // as game 1 of a fifth table; with no game number, a blitz game at a table
    // that has no slow game is read as the decider.
    const isDecider = (board: B): boolean =>
      board.details?.game !== undefined
        ? board.details.game === 1
        : !slowTables.has(board.details?.table);
    const playoffs = blitzBoards.filter((board) => !isDecider(board));
    const decider = blitzBoards.find(isDecider) ?? null;
    const slow = segment(slowBoards, teams);
    const blitz = segment(playoffs, teams);

    const tables = [...new Set([...slowBoards, ...playoffs].map((board) => board.details?.table))];
    const score: [number, number] = [0, 0];
    let missingTables = 0;
    for (const table of tables) {
      const slowGame = slowBoards.find((board) => board.details?.table === table);
      const playoff = playoffs.find((board) => board.details?.table === table);
      // A playoff is only ever played after a drawn slow game, so one whose
      // slow record the source lacks still says how that game ended.
      if (!slowGame && playoff) {
        slow.score[0] += GAME_DRAW_POINTS;
        slow.score[1] += GAME_DRAW_POINTS;
      }
      const slowWinner = slowGame ? gameWinner(slowGame, teams) : 'draw';
      const outcome =
        slowWinner !== 'draw' ? slowWinner : playoff ? gameWinner(playoff, teams) : 'missing';
      if (outcome === 'draw') {
        score[0] += GAME_DRAW_POINTS;
        score[1] += GAME_DRAW_POINTS;
      } else if (outcome === 0 || outcome === 1) {
        score[outcome] += GAME_WIN_POINTS;
      } else if (outcome === 'missing') {
        missingTables += 1;
      }
    }
    const finished = sorted.every((board) => board.status === 'complete');
    const level = score[0] === score[1];
    const deciderResult = decider ? gameWinner(decider, teams) : null;
    const complete = finished && missingTables === 0 && !(level && !decider);
    // A short match still has a winner when the missing tables could not
    // change it: each is worth at most a 2-point swing. The official table
    // counts such a match (Hebei's 9 after round 5 includes one).
    const lead = Math.abs(score[0] - score[1]);
    const decidedAnyway = finished && missingTables > 0 && lead > GAME_WIN_POINTS * missingTables;
    const winner: 0 | 1 | null =
      decidedAnyway || (complete && !level)
        ? score[0] > score[1]
          ? 0
          : 1
        : complete && (deciderResult === 0 || deciderResult === 1)
          ? deciderResult
          : null;
    matches.push({
      format: 'league',
      key: name,
      name,
      ...(list[0]?.details?.matchEn ? { nameEn: list[0].details.matchEn } : {}),
      teams,
      slow,
      blitz,
      decider,
      score,
      winner,
      deciderDrawn: complete && level && deciderResult === 'draw',
      wonOnPlayoff: false,
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

/** One women's league match: the slow games score the tables; a level match
 *  is settled by its blitz game(s), every blitz game in the match being the
 *  playoff whatever table the source files it under. */
function womensLeagueMatch<B extends MatchBoard>(
  name: string,
  sorted: B[],
  teams: [MatchTeam, MatchTeam],
): TeamMatch<B> {
  const slowBoards = sorted.filter((board) => board.details?.kind !== 'blitz');
  const playoffBoards = sorted.filter((board) => board.details?.kind === 'blitz');
  const slow = segment(slowBoards, teams);
  const blitz = segment(playoffBoards, teams);
  const score: [number, number] = [slow.score[0], slow.score[1]];
  const finished = sorted.every((board) => board.status === 'complete');
  const level = score[0] === score[1];
  const playoffPlayed = playoffBoards.length > 0;
  const complete = finished && slowBoards.length > 0 && (!level || playoffPlayed);
  const playoffWinner: 0 | 1 | null =
    blitz.score[0] === blitz.score[1] ? null : blitz.score[0] > blitz.score[1] ? 0 : 1;
  const winner: 0 | 1 | null = !complete
    ? null
    : !level
      ? score[0] > score[1]
        ? 0
        : 1
      : playoffWinner;
  return {
    format: 'womens-league',
    key: name,
    name,
    ...(sorted[0]?.details?.matchEn ? { nameEn: sorted[0].details.matchEn } : {}),
    teams,
    slow,
    blitz,
    // The playoff is the match's deciding game, the one line the card shows.
    decider: playoffBoards[0] ?? null,
    score,
    winner,
    deciderDrawn: complete && level && playoffWinner === null,
    wonOnPlayoff: complete && level && playoffWinner !== null,
    finished,
    complete,
  };
}

/**
 * A team championship's round (the 2026 national team championship): dpxq
 * tags every game with the section ("男子组"), not the match, so the match is
 * the two teams a game pits against each other, one slow game a table. A
 * round where some game has no team on a side is left ungrouped rather than
 * guessed at.
 */
function groupChampionshipRound<B extends MatchBoard>(
  boards: readonly B[],
): RoundByMatch<B> | null {
  const sectioned = boards.filter((board) => board.details?.match);
  if (sectioned.length === 0) return null;
  if (sectioned.some((board) => !board.red.federation || !board.black.federation)) return null;
  const byPair = new Map<string, B[]>();
  const other: B[] = boards.filter((board) => !board.details?.match);
  for (const board of sectioned) {
    const pair = [board.red.federation!, board.black.federation!].sort().join('|');
    if (board.red.federation === board.black.federation) {
      other.push(board);
      continue;
    }
    const list = byPair.get(pair) ?? [];
    list.push(board);
    byPair.set(pair, list);
  }
  const matches: TeamMatch<B>[] = [];
  for (const list of byPair.values()) {
    const sorted = [...list].sort(compareInMatch);
    const first = sorted[0]!;
    const teams: [MatchTeam, MatchTeam] = [teamOf(first.red), teamOf(first.black)];
    const slow = segment(sorted, teams);
    const score: [number, number] = [slow.score[0], slow.score[1]];
    const finished = sorted.every((board) => board.status === 'complete');
    const winner: 0 | 1 | null =
      finished && score[0] !== score[1] ? (score[0] > score[1] ? 0 : 1) : null;
    const name = `${teams[0].name}-${teams[1].name}`;
    matches.push({
      format: 'championship',
      key: name,
      name,
      ...(teams[0].nameEn && teams[1].nameEn
        ? { nameEn: `${teams[0].nameEn}-${teams[1].nameEn}` }
        : {}),
      teams,
      slow,
      blitz: { boards: [], score: [0, 0], wins: [0, 0] },
      decider: null,
      score,
      winner,
      deciderDrawn: false,
      wonOnPlayoff: false,
      finished,
      complete: finished,
    });
  }
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
  /** 慢棋总局分 and 慢棋总胜局, the league's last two tiebreaks. */
  slowGamePoints: number;
  slowWins: number;
  /** 对手总场分: the match points of every team this one played, a team
   *  championship's first tiebreak. */
  opponentsMatchPoints: number;
  /** 总胜局: games won, the championship's last tiebreak. */
  gameWins: number;
};

/** League table from finished matches, ranked the way the 规程 ranks it. */
export function teamStandings(
  boards: readonly MatchBoard[],
  rules: LeagueRules = 'league',
): TeamStandingsRow[] {
  const rows = new Map<string, TeamStandingsRow>();
  const opponents = new Map<string, string[]>();
  let format: MatchFormat = 'league';
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
        opponentsMatchPoints: 0,
        gameWins: 0,
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
    for (const match of groupRoundByMatch(list, rules)?.matches ?? []) {
      // A short match counts when its winner is beyond doubt; its table points
      // are then the ones on record.
      if (!match.complete && match.winner === null) continue;
      format = match.format;
      const points = MATCH_POINTS[match.format];
      const sides = match.teams.map(rowFor) as [TeamStandingsRow, TeamStandingsRow];
      sides.forEach((row, index) => {
        const other = match.teams[index === 0 ? 1 : 0]!.name;
        opponents.set(row.team.name, [...(opponents.get(row.team.name) ?? []), other]);
        row.matches += 1;
        // 总局分 is the tables' points; the deciding game settles the match only.
        row.gamePoints += match.score[index]!;
        row.slowGamePoints += match.slow.score[index]!;
        row.slowWins += match.slow.wins[index]!;
        row.gameWins += match.slow.wins[index]! + match.blitz.wins[index]!;
        if (match.winner === null) {
          row.draws += 1;
          row.matchPoints += points.draw;
        } else if (match.winner === index) {
          row.wins += 1;
          row.matchPoints += match.wonOnPlayoff ? points.playoffWin : points.win;
        } else {
          row.losses += 1;
          row.matchPoints += match.wonOnPlayoff ? points.playoffLoss : 0;
        }
      });
    }
  }
  // Opponents' match points need every team's total first.
  for (const row of rows.values()) {
    row.opponentsMatchPoints = (opponents.get(row.team.name) ?? []).reduce(
      (sum, name) => sum + (rows.get(name)?.matchPoints ?? 0),
      0,
    );
  }
  const tiebreak =
    format === 'womens-league'
      ? // 场分，慢棋总局分，慢棋胜局 (the women's league's 补充规定; 直胜 and
        // 犯规 after those are not in the data)
        (x: TeamStandingsRow, y: TeamStandingsRow) =>
          y.slowGamePoints - x.slowGamePoints || y.slowWins - x.slowWins
      : format === 'championship'
        ? // 场分，对手总场分，总局分，胜场，总胜局 (the championship's 规程)
          (x: TeamStandingsRow, y: TeamStandingsRow) =>
            y.opponentsMatchPoints - x.opponentsMatchPoints ||
            y.gamePoints - x.gamePoints ||
            y.wins - x.wins ||
            y.gameWins - x.gameWins
        : // 场分，总局分，慢棋总局分，慢棋总胜局 (the league's)
          (x: TeamStandingsRow, y: TeamStandingsRow) =>
            y.gamePoints - x.gamePoints ||
            y.slowGamePoints - x.slowGamePoints ||
            y.slowWins - x.slowWins;
  return [...rows.values()].sort(
    (x, y) =>
      y.matchPoints - x.matchPoints || tiebreak(x, y) || x.team.name.localeCompare(y.team.name),
  );
}

/** The format the matches in these boards are scored by, when any are. */
export function matchFormatOf(
  boards: readonly MatchBoard[],
  rules: LeagueRules = 'league',
): MatchFormat | null {
  return groupRoundByMatch(boards, rules)?.matches[0]?.format ?? null;
}

// 团体场分 by format: the 2026 men's league's 胜3 和1.5 负0; the women's
// league's 胜3 负0 on the slow games and 2-1 (1.5 each if drawn) on the
// playoff; the national team championship's 胜2 和1 负0. 个人局分 is 胜2 和1
// 负0 in all three.
const MATCH_POINTS: Record<
  MatchFormat,
  { win: number; draw: number; playoffWin: number; playoffLoss: number }
> = {
  league: { win: 3, draw: 1.5, playoffWin: 3, playoffLoss: 0 },
  'womens-league': { win: 3, draw: 1.5, playoffWin: 2, playoffLoss: 1 },
  championship: { win: 2, draw: 1, playoffWin: 2, playoffLoss: 0 },
};
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
  return Math.min(...matchBoards(match).map((board) => board.boardNumber));
}

/** Every game of a match in reading order: the slow games by table, the
 *  playoffs by table, then the deciding game. */
export function matchBoards<B extends MatchBoard>(match: TeamMatch<B>): B[] {
  return [...match.slow.boards, ...match.blitz.boards, ...(match.decider ? [match.decider] : [])];
}

/** Which side won a game: a team index, 'draw', or 'pending' while it runs. */
function gameWinner(board: MatchBoard, teams: [MatchTeam, MatchTeam]): 0 | 1 | 'draw' | 'pending' {
  if (board.status !== 'complete' || board.result === '*') return 'pending';
  if (board.result === '1/2-1/2') return 'draw';
  const redSide = board.red.federation === teams[0].name ? 0 : 1;
  return board.result === '1-0' ? redSide : redSide === 0 ? 1 : 0;
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

/**
 * A match names its two sides ("北京-江苏"). dpxq files other events' group in
 * the same tag: the 2026 national team championship's games all say "男子组"
 * (men's section), which read as one match of every team, grouped nothing and
 * left an empty Teams tab. Those events score by their own rules (a Swiss,
 * match points 2/1/0) anyway, so until they have them they stay one grid.
 */
export function isMatchName(name: string | undefined): name is string {
  return Boolean(name && /\S\s*[-–]\s*\S/.test(name));
}

/** Points with a half as "½": 1.5 match points read "1½". */
export function formatPoints(points: number): string {
  const whole = Math.floor(points);
  if (points - whole < 0.5) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}
