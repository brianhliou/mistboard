import { CHAMPIONS } from '@mistboard/board-render';
import { describe, expect, it } from 'vitest';
import { ARTICLE_LANGS, hasTranslation, translateArticleText } from '../article-i18n.js';
import { articleProse } from '../article-prose.js';
import { xiangqiChampionsArticle } from './content/xiangqi-champions.js';

// A person's name follows the page's script (Brian, 2026-11-06): a Traditional
// page shows 楊官璘, a Simplified page shows 杨官璘, wherever the player is from.
// The conversion is a hand-checked list rather than a rule, because a surname
// can convert wrongly: 于幼華 keeps 于 and 孫勇征 keeps 征.

const strings = articleProse(xiangqiChampionsArticle).map((entry) => entry.text);

const TRADITIONAL: Record<string, string> = {
  杨官璘: '楊官璘',
  李义庭: '李義庭',
  胡荣华: '胡榮華',
  柳大华: '柳大華',
  李来群: '李來群',
  吕钦: '呂欽',
  徐天红: '徐天紅',
  赵国荣: '趙國榮',
  许银川: '許銀川',
  陶汉明: '陶漢明',
  于幼华: '于幼華',
  洪智: '洪智',
  赵鑫鑫: '趙鑫鑫',
  蒋川: '蔣川',
  孙勇征: '孫勇征',
  王天一: '王天一',
  谢靖: '謝靖',
  郑惟桐: '鄭惟桐',
  徐超: '徐超',
  汪洋: '汪洋',
  王廓: '王廓',
  王禹博: '王禹博',
};

// People the article names who never won the title, and who appear only in the
// translations: the English writes them in romanization.
const OTHER_NAMES: Array<[string, string]> = [
  ['苏奕霖', '蘇奕霖'],
  ['张强', '張強'],
];

describe('champion names under translation', () => {
  it('has a hand-checked Traditional form for every champion', () => {
    expect(CHAMPIONS.filter((c) => !TRADITIONAL[c.zh]).map((c) => c.name)).toEqual([]);
  });

  it('writes each champion in the script of the page', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const champ of CHAMPIONS) {
      const hant = TRADITIONAL[champ.zh];
      for (const source of strings) {
        if (!source.includes(champ.zh)) continue;
        for (const lang of ARTICLE_LANGS) {
          if (!hasTranslation(lang, source)) continue;
          checked += 1;
          const expected = lang === 'zh-Hant' ? hant : champ.zh;
          if (!translateArticleText(lang, source).includes(expected)) {
            wrong.push(`[${lang}] ${champ.name}: expected ${expected}`);
          }
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(CHAMPIONS.length);
  });

  // The loop above reads the ENGLISH source, which only carries hanzi for the
  // champions: "Su Yilin" has no 苏奕霖 to find. So these are compared between
  // the two translations.
  it('writes a name that exists only in the translation in the script of the page', () => {
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const source of strings) {
      if (!hasTranslation('zh-Hans', source) || !hasTranslation('zh-Hant', source)) continue;
      const hans = translateArticleText('zh-Hans', source);
      const hant = translateArticleText('zh-Hant', source);
      for (const [simplified, traditional] of OTHER_NAMES) {
        if (!hans.includes(simplified)) continue;
        seen.add(simplified);
        if (!hant.includes(traditional)) wrong.push(`${simplified}: not ${traditional} in zh-Hant`);
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
    expect([...seen].sort()).toEqual(OTHER_NAMES.map(([s]) => s).sort());
  });

  it('writes each champion in the script of the page in the figure and table', () => {
    // Both are built from `Name 名字` keys rather than prose. A key with no
    // Traditional entry falls through to Simplified on a Traditional page.
    const wrong = CHAMPIONS.filter(
      (c) => !translateArticleText('zh-Hant', `${c.name} ${c.zh}`).includes(TRADITIONAL[c.zh]),
    ).map((c) => c.name);
    expect(wrong).toEqual([]);
  });

  it('has at least one champion name in the prose to protect', () => {
    // Guards the guard: if the headings stop carrying hanzi, the first test
    // passes by having nothing to check.
    const named = CHAMPIONS.filter((c) => strings.some((s) => s.includes(c.zh)));
    expect(named.length).toBeGreaterThanOrEqual(CHAMPIONS.length / 2);
  });
});
