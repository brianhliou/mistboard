import type { XiangqiBroadcastGameDetails, XiangqiBroadcastResult } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  formatPoints,
  groupRoundByMatch,
  type MatchBoard,
  teamStandings,
} from './xiangqi-broadcast-matches.js';

// Shapes from the 2026 men's league: 浙江-江苏 is played as 浙江民泰银行象棋队
// against 常熟文旅酒店, so the match name prefixes one side only. Each table
// plays a slow game and then a blitz game, colours swapped.
const ZJ = '浙江民泰银行象棋队';
const CS = '常熟文旅酒店';

let id = 0;
function game(
  red: [string, string],
  black: [string, string],
  result: XiangqiBroadcastResult,
  details: XiangqiBroadcastGameDetails,
  roundId = 'r01',
): MatchBoard & { roundId: string } {
  id += 1;
  return {
    id: `b${id}`,
    roundId,
    boardNumber: id,
    red: { name: red[0], federation: red[1] },
    black: { name: black[0], federation: black[1] },
    result,
    status: result === '*' ? 'live' : 'complete',
    details: { match: '浙江-江苏', ...details },
  };
}

const slow = (table: number) => ({ table, game: 1, kind: 'standard' as const });
const blitz = (table: number) => ({ table, game: 2, kind: 'blitz' as const });

// Round 1 as dpxq has it: four slow draws, then blitz ½, 1-0 浙江, 1-0 浙江, ½.
function round1(roundId = 'r01') {
  return [
    game(['许国义', CS], ['王宇航', ZJ], '1/2-1/2', blitz(1), roundId),
    game(['王宇航', ZJ], ['许国义', CS], '1/2-1/2', slow(1), roundId),
    game(['刘子健', CS], ['徐崇峰', ZJ], '1/2-1/2', slow(2), roundId),
    game(['徐崇峰', ZJ], ['刘子健', CS], '1-0', blitz(2), roundId),
    game(['王家瑞', ZJ], ['吴魏', CS], '1/2-1/2', slow(3), roundId),
    game(['吴魏', CS], ['王家瑞', ZJ], '0-1', blitz(3), roundId),
    game(['刘柏宏', CS], ['尹昇', ZJ], '1/2-1/2', slow(4), roundId),
    game(['尹昇', ZJ], ['刘柏宏', CS], '1/2-1/2', blitz(4), roundId),
  ];
}

describe('groupRoundByMatch', () => {
  it('leaves an individual event ungrouped', () => {
    expect(
      groupRoundByMatch([
        { ...game(['甲', ZJ], ['乙', CS], '1-0', slow(1)), details: { table: 1 } },
      ]),
    ).toBeNull();
  });

  it('splits a match into slow and blitz, tables in order, and scores both', () => {
    const match = groupRoundByMatch(round1())!.matches[0]!;
    // 浙江民泰… starts with 浙江, the match name's first side.
    expect(match.teams.map((team) => team.name)).toEqual([ZJ, CS]);
    expect(match.slow.boards.map((b) => b.details?.table)).toEqual([1, 2, 3, 4]);
    expect(match.blitz.boards.map((b) => b.details?.table)).toEqual([1, 2, 3, 4]);
    // Game points, 2 a win and 1 a draw: slow 4-4, blitz 6-2, match 10-6.
    expect(match.slow.score).toEqual([4, 4]);
    expect(match.blitz.score).toEqual([6, 2]);
    expect(match.score).toEqual([10, 6]);
    expect(match.winner).toBe(0);
  });

  it('holds the winner until every game is finished, and calls a level match a draw', () => {
    const live = round1();
    live[3] = { ...live[3]!, result: '*', status: 'live' };
    expect(groupRoundByMatch(live)!.matches[0]!.winner).toBeNull();
    expect(groupRoundByMatch(live)!.matches[0]!.finished).toBe(false);

    const level = round1().map((board) =>
      board.result === '1/2-1/2' ? board : { ...board, result: '1/2-1/2' as const },
    );
    const drawn = groupRoundByMatch(level)!.matches[0]!;
    expect(drawn.finished).toBe(true);
    expect(drawn.winner).toBeNull();
  });

  it('leaves a game with no team on a side outside the matches', () => {
    const lone = game(['甲', ZJ], ['乙', CS], '1-0', slow(1));
    lone.black = { name: '乙' };
    const grouped = groupRoundByMatch([lone, ...round1()]);
    expect(grouped!.other.map((b) => b.id)).toEqual([lone.id]);
  });
});

describe('teamStandings', () => {
  it('scores matches 3 / 1.5 / 0 per round and carries game points', () => {
    const drawnReturn = round1('r02').map((board) => ({
      ...board,
      result: '1/2-1/2' as const,
    }));
    const rows = teamStandings([...round1('r01'), ...drawnReturn]);
    expect(
      rows.map((row) => [
        row.team.name,
        row.matches,
        `${row.wins}-${row.draws}-${row.losses}`,
        row.matchPoints,
        row.gamePoints,
      ]),
    ).toEqual([
      [ZJ, 2, '1-1-0', 4.5, 18],
      [CS, 2, '0-1-1', 1.5, 14],
    ]);
  });
});

describe('formatPoints', () => {
  it('writes halves the way a scoreboard does', () => {
    expect([0, 0.5, 1, 1.5, 4.5, 10].map(formatPoints)).toEqual(['0', '½', '1', '1½', '4½', '10']);
  });
});

describe('a missing record', () => {
  it('marks the match short and keeps it out of the standings', () => {
    const short = round1().filter(
      (board) => !(board.details?.table === 2 && board.details.kind === 'blitz'),
    );
    const match = groupRoundByMatch(short)!.matches[0]!;
    expect(match.finished).toBe(true);
    expect(match.complete).toBe(false);
    expect(match.winner).toBeNull();
    expect(teamStandings(short)).toEqual([]);
  });
});
