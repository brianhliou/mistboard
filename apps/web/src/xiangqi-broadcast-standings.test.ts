import { describe, expect, it } from 'vitest';
import { broadcastStandings, formatStandingsScore } from './xiangqi-broadcast-standings.js';

const p = (name: string, federation?: string) => ({ name, ...(federation ? { federation } : {}) });

describe('broadcastStandings', () => {
  it('scores wins as 1 and draws as ½ and sorts by score then wins', () => {
    const rows = broadcastStandings([
      { red: p('尹昇'), black: p('陈绍博'), result: '1/2-1/2', status: 'complete' },
      { red: p('陈绍博'), black: p('尹昇'), result: '0-1', status: 'complete' },
      { red: p('杨世哲'), black: p('金波'), result: '1/2-1/2', status: 'complete' },
      { red: p('金波'), black: p('杨世哲'), result: '1/2-1/2', status: 'complete' },
    ]);
    expect(rows.map((r) => [r.player.name, r.score, r.wins, r.draws, r.losses])).toEqual([
      ['尹昇', 1.5, 1, 1, 0],
      ['金波', 1, 0, 2, 0],
      ['杨世哲', 1, 0, 2, 0],
      ['陈绍博', 0.5, 0, 1, 1],
    ]);
  });

  it('ignores live and scheduled boards: a game in progress is not a game played', () => {
    const rows = broadcastStandings([
      { red: p('a'), black: p('b'), result: '*', status: 'live' },
      { red: p('c'), black: p('d'), result: '*', status: 'scheduled' },
      { red: p('a'), black: p('c'), result: '1-0', status: 'complete' },
    ]);
    expect(rows.map((r) => [r.player.name, r.games])).toEqual([
      ['a', 1],
      ['c', 1],
    ]);
  });

  it('keys players by the source name, and picks up a team tag from any board', () => {
    const rows = broadcastStandings([
      { red: p('程宇东'), black: p('顾博文'), result: '0-1', status: 'complete' },
      { red: p('顾博文', '上海'), black: p('程宇东', '广东'), result: '1-0', status: 'complete' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.player).toEqual({ name: '顾博文', federation: '上海' });
    expect(rows[0]?.score).toBe(2);
  });

  it('ranks a player who played fewer games below an equal score', () => {
    const rows = broadcastStandings([
      { red: p('a'), black: p('b'), result: '1-0', status: 'complete' },
      { red: p('c'), black: p('d'), result: '1-0', status: 'complete' },
      { red: p('c'), black: p('e'), result: '0-1', status: 'complete' },
    ]);
    // a: 1 from 1; c: 1 from 2; e: 1 from 1.
    expect(rows.map((r) => r.player.name)).toEqual(['a', 'e', 'c', 'b', 'd']);
  });
});

describe('formatStandingsScore', () => {
  it('writes halves the way a wall chart does', () => {
    expect(formatStandingsScore(0)).toBe('0');
    expect(formatStandingsScore(0.5)).toBe('½');
    expect(formatStandingsScore(2)).toBe('2');
    expect(formatStandingsScore(2.5)).toBe('2½');
  });
});

describe('broadcastStandings with round-page results', () => {
  it('counts a result with no moves like any other game', () => {
    // A round page's pairing: the result is the source's, the moves never came.
    const rows = broadcastStandings([
      { red: p('郑彦隆'), black: p('吴宗翰'), result: '1-0', status: 'complete' },
      { red: p('吴宗翰'), black: p('于文彬'), result: '1/2-1/2', status: 'complete' },
      { red: p('于文彬'), black: p('郑彦隆'), result: '*', status: 'scheduled' },
    ]);
    expect(rows.map((r) => [r.player.name, r.games, r.score])).toEqual([
      ['郑彦隆', 1, 1],
      ['于文彬', 1, 0.5],
      ['吴宗翰', 2, 0.5],
    ]);
  });

  it('counts a slow game and its playoff at one table as one game', () => {
    // The 2024 Asian final, round 7 table 1: the slow game drawn, the rapid
    // playoff won by 刘柏宏. dpxq's table: 7 games, 6 won, 1 drawn.
    const round7 = [
      {
        red: p('黄学谦'),
        black: p('刘柏宏'),
        result: '1/2-1/2' as const,
        status: 'complete' as const,
        roundId: 'r07',
        details: { table: 1, game: 1, kind: 'standard' as const },
      },
      {
        red: p('刘柏宏'),
        black: p('黄学谦'),
        result: '1-0' as const,
        status: 'complete' as const,
        roundId: 'r07',
        details: { table: 1, game: 2, kind: 'rapid' as const },
      },
      {
        red: p('郑彦隆'),
        black: p('吴宗翰'),
        result: '1-0' as const,
        status: 'complete' as const,
        roundId: 'r07',
        details: { table: 2 },
      },
    ];
    const rows = broadcastStandings(round7);
    const liu = rows.find((r) => r.player.name === '刘柏宏');
    const wong = rows.find((r) => r.player.name === '黄学谦');
    expect([liu?.games, liu?.wins, liu?.draws, liu?.score]).toEqual([1, 1, 0, 1]);
    expect([wong?.games, wong?.losses, wong?.score]).toEqual([1, 1, 0]);
    // Two slow games at a table (no playoff) still count as two.
    const pair = broadcastStandings([
      { ...round7[0]!, details: { table: 1, game: 1, kind: 'standard' as const } },
      { ...round7[1]!, details: { table: 1, game: 2, kind: 'standard' as const } },
    ]);
    expect(pair.find((r) => r.player.name === '刘柏宏')?.games).toBe(2);
  });
});
