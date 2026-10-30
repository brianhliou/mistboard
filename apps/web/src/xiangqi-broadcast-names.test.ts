import { describe, expect, it } from 'vitest';
import {
  countText,
  localFederation,
  localName,
  localPlace,
  localRoundName,
  localTitle,
  otherName,
} from './xiangqi-broadcast-names.js';
import { formatEventDateRange, formatEventDay } from './xiangqi-broadcast-time.js';

const league = { name: '2026年全国象棋男子甲级联赛', nameEn: '2026 National Xiangqi League' };
const player = {
  name: '王天一',
  nameEn: 'Wang Tianyi',
  federation: '杭州',
  federationEn: 'Hangzhou',
};

describe('broadcast names follow the page locale', () => {
  it('English reads the English form, Chinese the source form, never both', () => {
    expect(localName(league, 'en')).toBe('2026 National Xiangqi League');
    expect(localName(league, 'zh-Hans')).toBe('2026年全国象棋男子甲级联赛');
    expect(localName(player, 'zh-Hant')).toBe('王天一');
    expect(otherName(player, 'en')).toBe('王天一');
    expect(otherName(player, 'zh-Hans')).toBe('Wang Tianyi');
    expect(localFederation(player, 'en')).toBe('Hangzhou');
    expect(localFederation(player, 'zh-Hans')).toBe('杭州');
  });

  it('a name with only one form shows it in every locale', () => {
    expect(localName({ name: 'Wajono Jong' }, 'zh-Hans')).toBe('Wajono Jong');
    expect(localName({ name: '张彬' }, 'en')).toBe('张彬');
    expect(otherName({ name: '张彬' }, 'en')).toBeNull();
  });

  it('stored "Round 9" reads 第9轮 in Chinese; other round names pass through', () => {
    expect(localName({ name: 'Round 9' }, 'zh-Hans')).toBe('第9轮');
    expect(localRoundName('Round 9', 'zh-Hant')).toBe('第9輪');
    expect(localRoundName('Round 9', 'en')).toBe('Round 9');
    expect(localRoundName('Final', 'zh-Hans')).toBe('Final');
  });

  it('stored English places read in Chinese; an unlisted one passes through', () => {
    expect(localPlace('Hangzhou', 'zh-Hans')).toBe('杭州');
    expect(localPlace('Suifenhe', 'zh-Hant')).toBe('綏芬河');
    expect(localPlace('Hangzhou', 'en')).toBe('Hangzhou');
    expect(localPlace('Atlantis', 'zh-Hans')).toBe('Atlantis');
  });

  it('counts take the plural only in English', () => {
    expect(countText(1, 'broadcast.roundCount', 'en')).toBe('1 round');
    expect(countText(39, 'broadcast.boardCount', 'en')).toBe('39 boards');
    expect(countText(39, 'broadcast.boardCount', 'zh-Hans')).toBe('39 台');
  });

  it('dates read in the site locale, not the browser', () => {
    // Planted: the zh round 9 page said "Sep 18" on an English browser.
    expect(formatEventDay('2026-09-18T10:00:00+08:00', 'zh-Hans')).not.toMatch(/Sep/);
    expect(formatEventDay('2026-09-18T10:00:00+08:00', 'en')).toMatch(/Sep 18/);
    expect(
      formatEventDateRange('2026-09-09T12:00:00+08:00', '2026-09-13T12:00:00+08:00', 'zh-Hans'),
    ).not.toMatch(/ to |Sep/);
  });
});

describe('localTitle', () => {
  it('writes the Chinese title in zh and keeps the Latin tag in English', () => {
    expect(localTitle('GM', 'zh-Hans')).toBe('特大');
    expect(localTitle('NM', 'zh-Hans')).toBe('大师');
    expect(localTitle('NM', 'zh-Hant')).toBe('大師');
    expect(localTitle('GM', 'en')).toBe('GM');
    expect(localTitle('FM', 'zh-Hans')).toBe('FM');
  });
});
