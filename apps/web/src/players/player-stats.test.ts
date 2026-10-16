import { describe, expect, it } from 'vitest';
import {
  filterBoards,
  filterFromSearch,
  openingsOf,
  opponentsOf,
  parseOpening,
  pointsOf,
  recordByColour,
  recordOf,
  type StatBoard,
  searchFromFilter,
} from './player-stats.js';

const cao = { name: '曹岩磊', nameEn: 'Cao Yanlei', slug: 'cao-yanlei' };
const meng = { name: '孟辰', nameEn: 'Meng Chen', slug: 'meng-chen' };
const guest = { name: '某人', nameEn: null, slug: null };

const boards: StatBoard[] = [
  { colour: 'red', outcome: 'win', opponent: cao, opening: 'C70 五七炮对屏风马进３卒' },
  { colour: 'red', outcome: 'draw', opponent: meng, opening: 'C70 五七炮对屏风马进３卒' },
  { colour: 'red', outcome: 'loss', opponent: cao, opening: 'A60 过宫炮局' },
  { colour: 'black', outcome: 'draw', opponent: cao, opening: 'E40 对兵局' },
  { colour: 'black', outcome: 'win', opponent: guest, opening: null },
  // A response from before the field existed.
  { colour: 'black', outcome: 'loss', opponent: meng },
];

describe('player stats', () => {
  it('counts the record overall and by colour', () => {
    const r = recordByColour(boards);
    expect(r.all).toEqual({ games: 6, wins: 2, draws: 2, losses: 2 });
    expect(r.red).toEqual({ games: 3, wins: 1, draws: 1, losses: 1 });
    expect(r.black).toEqual({ games: 3, wins: 1, draws: 1, losses: 1 });
    expect(pointsOf(r.all)).toBe(3);
  });

  it('lists opponents by games, keyed by slug, else by name', () => {
    const rows = opponentsOf(boards);
    expect(rows.map((o) => [o.key, o.record.games, pointsOf(o.record)])).toEqual([
      ['cao-yanlei', 3, 1.5],
      ['meng-chen', 2, 0.5],
      ['某人', 1, 1],
    ]);
  });

  it('reads the ECCO code off the opening', () => {
    expect(parseOpening('C70 五七炮对屏风马进３卒')).toEqual({
      code: 'C70',
      name: '五七炮对屏风马进３卒',
    });
    expect(parseOpening('E45 对兵互进右马局 红边炮')).toEqual({
      code: 'E45',
      name: '对兵互进右马局 红边炮',
    });
    expect(parseOpening('中炮对屏风马')).toEqual({ code: null, name: '中炮对屏风马' });
    expect(parseOpening('  ')).toBe(null);
    expect(parseOpening(undefined)).toBe(null);
  });

  it('groups openings by colour, most played first, leaving out unnamed games', () => {
    expect(openingsOf(boards, 'red').map((o) => [o.key, o.record.games, o.record.wins])).toEqual([
      ['C70', 2, 1],
      ['A60', 1, 0],
    ]);
    expect(openingsOf(boards, 'black').map((o) => [o.key, o.record.games])).toEqual([['E40', 1]]);
  });

  it('filters the games by colour, opponent and opening together', () => {
    expect(filterBoards(boards, { opponent: 'cao-yanlei' })).toHaveLength(3);
    expect(filterBoards(boards, { opponent: 'cao-yanlei', colour: 'red' })).toHaveLength(2);
    expect(filterBoards(boards, { opening: 'C70' })).toHaveLength(2);
    expect(recordOf(filterBoards(boards, { opponent: '某人' }))).toEqual({
      games: 1,
      wins: 1,
      draws: 0,
      losses: 0,
    });
    expect(filterBoards(boards, {})).toHaveLength(6);
  });

  it('round-trips the filter through the URL, dropping values the games lack', () => {
    const search = searchFromFilter({ colour: 'red', opponent: 'cao-yanlei', opening: 'C70' });
    expect(search).toBe('?colour=red&vs=cao-yanlei&opening=C70');
    expect(filterFromSearch(search, boards)).toEqual({
      colour: 'red',
      opponent: 'cao-yanlei',
      opening: 'C70',
    });
    expect(filterFromSearch('?colour=blue&vs=nobody&opening=B99', boards)).toEqual({});
    expect(searchFromFilter({})).toBe('');
  });
});
