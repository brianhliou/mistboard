import { describe, expect, it } from 'vitest';
import { gameCoachContext, gameRowParts, shortEvent } from './study-game-row.js';

const chapter = {
  orientation: 'black',
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
  it('marks the side the learner plays', () => {
    expect(gameRowParts(chapter, 'en')).toEqual({
      red: 'Gu Bowen',
      black: 'Jiang Mingcheng',
      toMove: 'black',
    });
  });

  it('localizes the players', () => {
    expect(gameRowParts(chapter, 'zh-Hans')).toMatchObject({ red: '顾博文', black: '蒋明成' });
  });

  it('follows the orientation, not the start position', () => {
    expect(gameRowParts({ ...chapter, orientation: 'red' }, 'en')?.toMove).toBe('red');
  });

  it('is null for a chapter that is not a game', () => {
    expect(gameRowParts({ orientation: 'red', tags: { red: 'A' } }, 'en')).toBeNull();
  });
});

describe('gameCoachContext', () => {
  it('lists the event, round, date and result (the players are the seat strips)', () => {
    expect(gameCoachContext(chapter, 'en')).toEqual({
      detail: 'National Xiangqi Men Division A League · Round 3 · 2026-09-16 · 1-0',
    });
  });

  it('localizes the event and round', () => {
    expect(gameCoachContext(chapter, 'zh-Hans')).toEqual({
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
