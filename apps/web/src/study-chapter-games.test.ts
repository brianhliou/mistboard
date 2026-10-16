import { describe, expect, it } from 'vitest';
import tonyFungChapters from './study-chapter-games.fixture.json' with { type: 'json' };
import {
  buildChapterGameRow,
  chapterEventGroups,
  displayEventName,
  focusScore,
  type GameChapter,
  gameOutcome,
  shortGameDate,
  studyFocusPlayer,
  studyGamesSummary,
} from './study-chapter-games.js';

describe('displayEventName', () => {
  // Every event in the Tony Fung import (study 3ii1g3EK, 47 games from dpxq).
  const studyEvents: Array<[string, string]> = [
    ['2022年第17届世界象棋锦标赛', '2022 17th World Xiangqi Championship'],
    [
      '2025年全国象棋男子甲级联赛“华体龙江杯”预选赛',
      "2025 National Xiangqi Men's Division A League Huatilongjiang Cup Qualifier",
    ],
    [
      '2025年第五届“上海杯”象棋大师公开赛海选赛',
      '2025 5th Shanghai Cup Xiangqi Masters Open Qualifier',
    ],
    ['2025年第十五届全运会群众比赛象棋决赛', '2025 15th National Games Amateur Xiangqi Final'],
    ['2025年农行杯第19届世界象棋锦标赛', '2025 Nonghang Cup 19th World Xiangqi Championship'],
    ['2025年第三届世界象棋快棋公开赛', '2025 3rd World Xiangqi Rapid Open'],
    [
      '2026年第32届“五羊杯”全国象棋冠军赛',
      '2026 32nd Five Rams Cup National Xiangqi Champions Tournament',
    ],
    [
      '2026年全国象棋男子甲级联赛“腾讯天天象棋”预选赛',
      "2026 National Xiangqi Men's Division A League Tencent Tiantian Xiangqi Qualifier",
    ],
    ['2026年第六届“上海杯”象棋大师公开赛', '2026 6th Shanghai Cup Xiangqi Masters Open'],
  ];

  it.each(studyEvents)('translates %s', (zh, en) => {
    expect(displayEventName(zh, 'en')).toBe(en);
  });

  it.each([
    ['2024年全国象棋个人赛', '2024 National Xiangqi Individual Championship'],
    ['2025年全国象棋女子甲级联赛', "2025 National Xiangqi Women's Division A League"],
    ['2026年第十届北美杯象棋锦标赛', '2026 North American Xiangqi Championship'],
    ['2023年第四届广东十虎对抗赛', '2023 4th Guangdong Ten Tigers Match'],
    ['2018年亚运会象棋', '2018 Asian Games Xiangqi'],
    ['中国象棋亚洲杯', 'Xiangqi Asian Cup'],
    ['全国象棋选拔赛', 'National Xiangqi Qualifier'],
    ['2019年亚洲象棋锦标赛', '2019 Asian Xiangqi Championship'],
  ])('translates the common name %s', (zh, en) => {
    expect(displayEventName(zh, 'en')).toBe(en);
  });

  it.each(['魔力红杯', '将军杯', '2025年第五届魔力红杯象棋公开赛'])(
    'keeps %s as written when a part is not in the glossary',
    (zh) => {
      expect(displayEventName(zh, 'en')).toBe(zh);
    },
  );

  it('leaves an English name and a Chinese page alone', () => {
    expect(displayEventName('2026 Hong Kong Open', 'en')).toBe('2026 Hong Kong Open');
    expect(displayEventName('2022年第17届世界象棋锦标赛', 'zh-Hans')).toBe(
      '2022年第17届世界象棋锦标赛',
    );
    expect(displayEventName('2022年第17届世界象棋锦标赛', 'zh-Hant')).toBe(
      '2022年第17届世界象棋锦标赛',
    );
  });
});

describe('gameOutcome', () => {
  it('reads the PGN result forms', () => {
    expect(gameOutcome('1-0')).toBe('red');
    expect(gameOutcome('0-1')).toBe('black');
    expect(gameOutcome('1/2-1/2')).toBe('draw');
    expect(gameOutcome('½-½')).toBe('draw');
    expect(gameOutcome('*')).toBeNull();
    expect(gameOutcome(undefined)).toBeNull();
  });
});

const game = (id: string, red: string, black: string, result = '1-0', extra = {}): GameChapter => ({
  id,
  tags: { red, black, result, ...extra },
});

describe('studyFocusPlayer', () => {
  it('finds the one player in every game', () => {
    expect(studyFocusPlayer([game('a', 'Tony', 'Calvin'), game('b', 'Lee', 'Tony', '0-1')])).toBe(
      'Tony',
    );
  });

  it('is null for a two-player match: both names are in every game', () => {
    expect(
      studyFocusPlayer([game('a', 'Wang', 'Xu'), game('b', 'Xu', 'Wang'), game('c', 'Wang', 'Xu')]),
    ).toBeNull();
  });

  it('is null for a single game and for a tournament with no common player', () => {
    expect(studyFocusPlayer([game('a', 'Tony', 'Calvin')])).toBeNull();
    expect(studyFocusPlayer([game('a', 'A', 'B'), game('b', 'C', 'D')])).toBeNull();
  });

  it('ignores chapters that are not games', () => {
    expect(
      studyFocusPlayer([
        { id: 'intro', tags: {} },
        game('a', 'Tony', 'Calvin'),
        game('b', 'Lee', 'Tony'),
      ]),
    ).toBe('Tony');
  });
});

describe('the Tony Fung study', () => {
  // The chapters' tags as prod stores them (study 3ii1g3EK, 2026-10-08).
  const fixture = tonyFungChapters as GameChapter[];

  it('has 47 games with the stored results', () => {
    const results = fixture.map((chapter) => chapter.tags?.result);
    expect(results.filter((r) => r === '1-0')).toHaveLength(19);
    expect(results.filter((r) => r === '1/2-1/2')).toHaveLength(17);
    expect(results.filter((r) => r === '0-1')).toHaveLength(11);
  });

  it('scores the games from Tony Fung’s side, not Red’s', () => {
    const focus = studyFocusPlayer(fixture);
    expect(focus).toBe('Tony Fung Ga Zen');
    expect(focusScore(fixture, focus!)).toEqual({ games: 47, wins: 20, draws: 17, losses: 10 });
  });

  it('summarises the study in one line', () => {
    expect(studyGamesSummary(fixture, 'en')).toBe(
      '47 games · Oct 2022 to Sep 2026 · Tony Fung Ga Zen +20 =17 -10',
    );
    // The Chinese page names the player as the Chinese tags do.
    expect(studyGamesSummary(fixture, 'zh-Hans')).toContain('冯家俊');
  });

  it('opens a group at each change of event', () => {
    const groups = chapterEventGroups(fixture, 'en');
    expect(groups.size).toBeGreaterThanOrEqual(9);
    expect(groups.get(fixture[0]!.id)).toBe('2022 17th World Xiangqi Championship');
    for (const name of groups.values()) expect(name).not.toMatch(/\p{Script=Han}/u);
  });
});

describe('chapterEventGroups', () => {
  it('is empty when every game is from one event', () => {
    const chapters = [
      game('a', 'A', 'B', '1-0', { event: '2024年全国象棋个人赛' }),
      game('b', 'C', 'D', '1-0', { event: '2024年全国象棋个人赛' }),
    ];
    expect(chapterEventGroups(chapters, 'en').size).toBe(0);
  });
});

describe('shortGameDate', () => {
  it('formats a full tag date and leaves a partial one as written', () => {
    expect(shortGameDate('2022-10-24', 'en')).toBe('Oct 24, 2022');
    expect(shortGameDate('2022.10.24', 'en')).toBe('Oct 24, 2022');
    expect(shortGameDate('2022.??.??', 'en')).toBe('2022.??.??');
    expect(shortGameDate('2022-10-24', 'zh-Hans')).toBe('2022年10月24日');
  });
});

describe('buildChapterGameRow', () => {
  it('bolds the winner and colours the chip from the focus player’s side', () => {
    const row = buildChapterGameRow(
      game('a', 'Lee', 'Tony', '1-0', { date: '2025-07-02', round: '3' }),
      'Tony',
      'en',
    )!;
    expect(row.querySelector('.study-game-line__players')?.textContent).toBe('Lee vs Tony');
    expect(row.querySelector('.is-winner')?.textContent).toBe('Lee');
    expect(row.querySelector('.study-game-line__meta')?.textContent).toBe('Jul 2, 2025 · Round 3');
    const chip = row.querySelector<HTMLElement>('.study-game-line__result')!;
    expect(chip.textContent).toBe('1-0');
    expect(chip.dataset.outcome).toBe('loss');
  });

  it('is neutral without a focus player and null for a chapter that is not a game', () => {
    const row = buildChapterGameRow(game('a', 'A', 'B', '1/2-1/2'), null, 'en')!;
    expect(row.querySelector<HTMLElement>('.study-game-line__result')!.dataset.outcome).toBe(
      'neutral',
    );
    expect(row.querySelector('.is-winner')).toBeNull();
    expect(buildChapterGameRow({ id: 'intro', tags: { event: 'x' } }, null, 'en')).toBeNull();
  });
});
