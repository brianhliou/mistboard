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
