import { WORLD_CHAMPIONS } from '@mistboard/board-render';
import { describe, expect, it } from 'vitest';
import { ARTICLE_LANGS, hasTranslation, translateArticleText } from '../article-i18n.js';
import { articleProse, articleTranslationSourceStrings } from '../article-prose.js';
import { xiangqiWorldChampionshipArticle as article } from './content/xiangqi-world-championship.js';

// A person's name follows the page's script (Brian, 2026-11-06), wherever the
// player is from. Simplified rendering -> Traditional rendering.
const NAMES: Array<[string, string]> = [
  ['吕钦', '呂欽'],
  ['赵国荣', '趙國榮'],
  ['徐天红', '徐天紅'],
  ['许银川', '許銀川'],
  ['赵鑫鑫', '趙鑫鑫'],
  ['蒋川', '蔣川'],
  ['郑惟桐', '鄭惟桐'],
  ['胡荣华', '胡榮華'],
  ['吴贵临', '吳貴臨'], // Chinese Taipei
  ['李锦欢', '李錦歡'], // Macau
  ['黄学谦', '黃學謙'], // Hong Kong
  ['冯家俊', '馮家俊'], // Hong Kong
  ['赖理兄', '賴理兄'], // Vietnam
];

// The names live in headings and captions (prose) AND inside the replay specs
// and the table, which prose deliberately skips. Both are dictionary keys, so
// both are checked.
const sources = [
  ...new Set([
    ...articleProse(article).map((entry) => entry.text),
    ...articleTranslationSourceStrings([article]),
  ]),
];

describe('world champion names under translation', () => {
  it('writes every name in the script of the page', () => {
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      if (!hasTranslation('zh-Hans', source)) continue;
      const hans = translateArticleText('zh-Hans', source);
      for (const [simplified, traditional] of NAMES) {
        if (!hans.includes(simplified)) continue;
        seen.add(simplified);
        const hant = translateArticleText('zh-Hant', source);
        if (!hant.includes(traditional)) {
          wrong.push(`${simplified}: expected ${traditional}, got "${hant.slice(0, 44)}"`);
        }
      }
      for (const [, traditional] of NAMES) {
        if (hans.includes(traditional)) wrong.push(`${traditional}: Traditional on a Simplified page`);
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
    // Guards the guard: with no name found, the loop passes for free, which is
    // exactly what a broken extraction looks like.
    expect([...seen].sort()).toEqual(NAMES.map(([s]) => s).sort());
  });

  it('names every world champion in both scripts', () => {
    // The chart and the table are built from WORLD_CHAMPIONS, so a champion
    // whose name never reaches the dictionary renders English in a Chinese row.
    const missing = WORLD_CHAMPIONS.filter((champion) =>
      ARTICLE_LANGS.some((lang) => !hasTranslation(lang, champion.name)),
    );
    expect(missing.map((c) => c.name), 'champions with no name translation').toEqual([]);
  });
});
