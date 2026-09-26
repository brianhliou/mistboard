import { describe, expect, it } from 'vitest';
import { gameCoachContext, gameRowParts, shortEvent } from './study-game-row.js';

const chapter = {
  orientation: 'black',
  root: { rootFen: 'rc1akab2/9/2R1b1n2/p3p1p1p/9/1R4P2/P1N1P3P/2C1C4/4AK3/2BA3rc b - - 7 21' },
  tags: {
    red: 'Gu Bowen',
    black: 'Jiang Mingcheng',
    event: '2026 National Xiangqi Men Division A League',
    round: 'Round 3',
    date: '2026-09-16',
    result: '1-0',
  },
  i18n: {
    'zh-Hans': { tags: { red: '顾博文', black: '蒋明成', event: '2026年全国象棋男子甲级联赛' } },
  },
};

describe('gameRowParts', () => {
  it('reads the side to move from the start position', () => {
    expect(gameRowParts(chapter, 'en')).toEqual({
      red: 'Gu Bowen',
      black: 'Jiang Mingcheng',
      toMove: 'black',
    });
  });

  it('localizes the players', () => {
    expect(gameRowParts(chapter, 'zh-Hans')).toMatchObject({ red: '顾博文', black: '蒋明成' });
  });

  it('falls back to the orientation without a start position', () => {
    expect(gameRowParts({ ...chapter, root: null, orientation: 'red' }, 'en')?.toMove).toBe('red');
  });

  it('is null for a chapter that is not a game', () => {
    expect(gameRowParts({ orientation: 'red', tags: { red: 'A' } }, 'en')).toBeNull();
  });
});

describe('gameCoachContext', () => {
  it('puts players first and the event, round, date and result under them', () => {
    expect(gameCoachContext(chapter, 'en')).toEqual({
      players: 'Gu Bowen – Jiang Mingcheng',
      detail: 'National Xiangqi Men Division A League · Round 3 · 2026-09-16 · 1-0',
    });
  });

  it('localizes the players, event and round', () => {
    expect(gameCoachContext(chapter, 'zh-Hans')).toEqual({
      players: '顾博文 – 蒋明成',
      detail: '全国象棋男子甲级联赛 · 第 3 轮 · 2026-09-16 · 1-0',
    });
  });
});

describe('shortEvent', () => {
  it('strips a leading year in either script', () => {
    expect(shortEvent('2026 6th Shanghai Cup Xiangqi Dashi Open')).toBe(
      '6th Shanghai Cup Xiangqi Dashi Open',
    );
    expect(shortEvent('2026年全国象棋男子甲级联赛')).toBe('全国象棋男子甲级联赛');
  });
});
