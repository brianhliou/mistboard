import { personNameForLocale } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { localizedChapterTags, parseStudyI18n } from './study-i18n.js';

// The players and the event sit beside the board and under the description on a
// localized study page. They were the last English strings left there: the
// chapter list, the study name, the description and the field labels all
// translated around two names that did not.
const tags = {
  red: 'Xu Chao',
  black: 'Huang Xueqian',
  result: '1-0',
  date: '2019-10-07',
  event: '2019 16th World Xiangqi Championship',
};

const i18n = {
  'zh-Hant': {
    name: '2019 · 徐超',
    tags: { red: '徐超', black: '黃學謙', event: '2019年第十六屆世界象棋錦標賽' },
  },
};

describe('localized chapter tags', () => {
  it('swaps the names and the event for the reader locale', () => {
    const out = localizedChapterTags(tags, i18n, 'zh-Hant');
    expect(out.red).toBe('徐超');
    expect(out.black).toBe('黃學謙');
    expect(out.event).toBe('2019年第十六屆世界象棋錦標賽');
  });

  it('leaves a date and a result alone', () => {
    // These carry no language. Translating `1-0` would be inventing a
    // difference, and the overlay does not accept them at all.
    const out = localizedChapterTags(tags, i18n, 'zh-Hant');
    expect(out.result).toBe('1-0');
    expect(out.date).toBe('2019-10-07');
    expect(parseStudyI18n({ en: { tags: { result: '1:0', date: 'x' } } })).toEqual({});
  });

  it('falls back per string, not per chapter', () => {
    // A half-written overlay must translate what it has and leave the rest,
    // rather than dropping to English wholesale.
    const partial = { 'zh-Hans': { tags: { red: '徐超' } } };
    const out = localizedChapterTags(tags, partial, 'zh-Hans');
    expect(out.red).toBe('徐超');
    expect(out.black).toBe('Huang Xueqian');
  });

  it('returns the base tags for a locale with no overlay, and for junk', () => {
    expect(localizedChapterTags(tags, i18n, 'en')).toEqual(tags);
    expect(localizedChapterTags(tags, undefined, 'zh-Hant')).toEqual(tags);
    expect(localizedChapterTags(tags, 'not an object', 'zh-Hant')).toEqual(tags);
    expect(localizedChapterTags(tags, { 'zh-Hant': { tags: [] } }, 'zh-Hant')).toEqual(tags);
  });

  it('never invents a tag the chapter does not have', () => {
    // An overlay naming Black on a chapter with no Black would put a player on
    // a board that has none.
    const sparse: Record<string, string | undefined> = { red: 'Xu Chao' };
    const out = localizedChapterTags(sparse, i18n, 'zh-Hant');
    expect(out.black).toBeUndefined();
    expect(out.red).toBe('徐超');
  });
});

it('renders both page scripts from checked person tag overlays', () => {
  const source = { red: 'Yu Youhua', black: 'Sun Yongzheng', result: '1-0' };
  const overlays = Object.fromEntries(
    ['zh-Hans', 'zh-Hant'].map((locale) => [
      locale,
      {
        tags: {
          red: personNameForLocale({ name: '于幼华', nameOwn: '於幼華' }, locale),
          black: personNameForLocale({ name: '孙勇征', nameOwn: '孫勇徵' }, locale),
        },
      },
    ]),
  );
  expect(localizedChapterTags(source, overlays, 'zh-Hans')).toEqual({
    ...source,
    red: '于幼华',
    black: '孙勇征',
  });
  expect(localizedChapterTags(source, overlays, 'zh-Hant')).toEqual({
    ...source,
    red: '于幼華',
    black: '孫勇征',
  });
  expect(localizedChapterTags(source, overlays, 'en')).toEqual(source);
});
