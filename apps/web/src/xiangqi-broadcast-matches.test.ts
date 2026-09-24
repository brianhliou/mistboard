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
// plays a slow game; a drawn one gets a blitz playoff, colours swapped; a match
// level after its tables gets one deciding blitz game (the source's table 5).
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
const decider = () => ({ table: 5, game: 1, kind: 'blitz' as const });

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

  it('scores each table once: its slow game, or the playoff after a drawn one', () => {
    const match = groupRoundByMatch(round1())!.matches[0]!;
    // 浙江民泰… starts with 浙江, the match name's first side.
    expect(match.teams.map((team) => team.name)).toEqual([ZJ, CS]);
    expect(match.slow.boards.map((b) => b.details?.table)).toEqual([1, 2, 3, 4]);
    expect(match.blitz.boards.map((b) => b.details?.table)).toEqual([1, 2, 3, 4]);
    // Four drawn slow games; the playoffs go ½, 浙江, 浙江, ½. Tables score 2 a
    // win and 1 a draw: 1+2+2+1 against 1+0+0+1. Counting the slow and blitz
    // games separately (the old reading) made it 10-6.
    expect(match.score).toEqual([6, 2]);
    expect(match.slow.score).toEqual([4, 4]);
    expect(match.winner).toBe(0);
    expect(match.complete).toBe(true);
  });

  it('plays no playoff after a decisive slow game, and is not short for it', () => {
    const boards = [
      game(['王宇航', ZJ], ['许国义', CS], '1-0', slow(1)),
      game(['刘子健', CS], ['徐崇峰', ZJ], '1-0', slow(2)),
      game(['王家瑞', ZJ], ['吴魏', CS], '1/2-1/2', slow(3)),
      game(['吴魏', CS], ['王家瑞', ZJ], '0-1', blitz(3)),
      game(['刘柏宏', CS], ['尹昇', ZJ], '0-1', slow(4)),
    ];
    const match = groupRoundByMatch(boards)!.matches[0]!;
    expect(match.score).toEqual([6, 2]);
    expect(match.complete).toBe(true);
    expect(match.winner).toBe(0);
  });

  it('settles a level match with the deciding game, and leaves a drawn one drawn', () => {
    const level = [
      game(['王宇航', ZJ], ['许国义', CS], '1-0', slow(1)),
      game(['刘子健', CS], ['徐崇峰', ZJ], '1-0', slow(2)),
    ];
    const noDecider = groupRoundByMatch(level)!.matches[0]!;
    expect(noDecider.score).toEqual([2, 2]);
    // Level with no deciding game on record: short, not a draw.
    expect(noDecider.complete).toBe(false);

    const won = groupRoundByMatch([...level, game(['尹昇', ZJ], ['刘柏宏', CS], '0-1', decider())])!
      .matches[0]!;
    expect(won.decider?.details?.table).toBe(5);
    expect(won.score).toEqual([2, 2]);
    expect(won.winner).toBe(1);
    expect(won.deciderDrawn).toBe(false);

    const drawn = groupRoundByMatch([
      ...level,
      game(['尹昇', ZJ], ['刘柏宏', CS], '1/2-1/2', decider()),
    ])!.matches[0]!;
    expect(drawn.complete).toBe(true);
    expect(drawn.winner).toBeNull();
    expect(drawn.deciderDrawn).toBe(true);
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

describe('records the source lacks', () => {
  it('reads a playoff whose slow game is missing as a playoff, the slow game drawn', () => {
    // Round 6, 成都-深圳 as dpxq has it: table 1's slow game is not there, its
    // playoff is. By table number alone it looked like the deciding game.
    const boards = [
      game(['许国义', CS], ['王宇航', ZJ], '1/2-1/2', blitz(1)),
      game(['刘子健', CS], ['徐崇峰', ZJ], '0-1', slow(2)),
      game(['王家瑞', ZJ], ['吴魏', CS], '1-0', slow(3)),
    ];
    const match = groupRoundByMatch(boards)!.matches[0]!;
    expect(match.decider).toBeNull();
    expect(match.blitz.boards.map((b) => b.details?.table)).toEqual([1]);
    expect(match.score).toEqual([5, 1]);
    expect(match.slow.score).toEqual([5, 1]);
    expect(match.complete).toBe(true);
  });

  it('still names the winner of a short match when the missing tables cannot change it', () => {
    // Table 1's slow game drawn, its playoff missing (worth at most 2), and
    // 浙江 ahead 4-0 on the other two: 浙江 won, as the official table counts it.
    const boards = [
      game(['王宇航', ZJ], ['许国义', CS], '1/2-1/2', slow(1)),
      game(['刘子健', CS], ['徐崇峰', ZJ], '0-1', slow(2)),
      game(['王家瑞', ZJ], ['吴魏', CS], '1-0', slow(3)),
    ];
    const match = groupRoundByMatch(boards)!.matches[0]!;
    expect(match.complete).toBe(false);
    expect(match.winner).toBe(0);
    expect(teamStandings(boards).map((row) => [row.team.name, row.matchPoints])).toEqual([
      [ZJ, 3],
      [CS, 0],
    ]);
  });
});

describe('teamStandings', () => {
  it('scores matches 3 / 1.5 / 0 per round and carries table points', () => {
    // The return match: every game drawn, the deciding game too.
    const drawnReturn = [
      ...round1('r02').map((board) => ({ ...board, result: '1/2-1/2' as const })),
      game(['尹昇', ZJ], ['刘柏宏', CS], '1/2-1/2', decider(), 'r02'),
    ];
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
      [ZJ, 2, '1-1-0', 4.5, 10],
      [CS, 2, '0-1-1', 1.5, 6],
    ]);
  });
});

describe('formatPoints', () => {
  it('writes halves the way a scoreboard does', () => {
    expect([0, 0.5, 1, 1.5, 4.5, 10].map(formatPoints)).toEqual(['0', '½', '1', '1½', '4½', '10']);
  });
});

describe('a missing record', () => {
  it('marks a drawn slow game with no playoff short, and keeps the match out of the standings', () => {
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
