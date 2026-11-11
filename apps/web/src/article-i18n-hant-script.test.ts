import { describe, expect, it } from 'vitest';
import { translateArticleText, translationKeys } from './article-i18n.js';

// ZH_HANT opens with the Simplified spread, so a key with no Traditional entry
// serves Simplified text on a Traditional page and nothing else notices.
// Blind spot: this is a fixed list of characters that are never Traditional,
// the ones the 2026-11 audit found, so a Simplified character outside it
// passes. Characters that exist in both scripts (后, 于, 党, 里) stay out.
const SIMPLIFIED_ONLY =
  '静刘报摄陈丽时凤兰将国际规则荣华杨义来吕钦红赵许银汉蒋孙谢郑张强苏届运动会黄颖砚伟东泽韩传号吴跃飞继鹏阳达鸣聂铁风铭玮陆韬辉龙马旸鹤岿广军兽';
// Spellings a Traditional page cites on purpose: the mainland name of Jungle
// and a Japanese magazine title.
const CITED_SPELLINGS = ['斗兽棋', '詰将棋パラダイス'];

// A name is not a word to convert blindly: these are the wrong Traditional
// forms a character-by-character conversion produces. 党, 于, 征, 峰 and 岩 are
// the correct characters in these names.
const WRONG_NAME_FORMS = ['黨斐', '於幼華', '孫勇徵', '徐崇峯', '曹巖磊'];

function simplifiedOnlyIn(text: string): string[] {
  let body = text;
  for (const spelling of CITED_SPELLINGS) {
    body = body.replaceAll(spelling, '');
  }
  return [...new Set([...body].filter((ch) => SIMPLIFIED_ONLY.includes(ch)))];
}

describe('zh-Hant serves Traditional text', () => {
  it('has none of the known wrong conversions of a name', () => {
    const wrongName = (text: string) => WRONG_NAME_FORMS.some((form) => text.includes(form));
    expect(wrongName('呂欽對於幼華')).toBe(true);
    expect(wrongName('呂欽對于幼華')).toBe(false);
    const bad = translationKeys('zh-Hant')
      .map((key) => translateArticleText('zh-Hant', key))
      .filter(wrongName);
    expect(bad).toEqual([]);
  });

  it('flags a planted Simplified string and passes its Traditional form', () => {
    expect(simplifiedOnlyIn('揭棋规则')).toEqual(['规', '则']);
    expect(simplifiedOnlyIn('揭棋規則')).toEqual([]);
    // A name is checked like any other text.
    expect(simplifiedOnlyIn('楊官璘的象棋規則')).toEqual([]);
    expect(simplifiedOnlyIn('杨官璘的象棋規則')).toEqual(['杨']);
    expect(simplifiedOnlyIn('楊官璘的象棋规则')).toEqual(['规', '则']);
  });

  it('has no Simplified-only character in any article string', () => {
    const bad = translationKeys('zh-Hant')
      .map((key) => translateArticleText('zh-Hant', key))
      .filter((text) => simplifiedOnlyIn(text).length > 0);
    expect(bad).toEqual([]);
  });

  it('has no Simplified-only character in any interface string', async () => {
    const { domains } = await import('./i18n/locales/zh-hant.js');
    const catalogs = Object.values(domains);
    expect(catalogs.length).toBeGreaterThan(5);
    const bad = catalogs
      .flatMap((catalog) => Object.values(catalog))
      .filter((text): text is string => typeof text === 'string')
      .filter((text) => simplifiedOnlyIn(text).length > 0);
    expect(bad).toEqual([]);
  });
});
