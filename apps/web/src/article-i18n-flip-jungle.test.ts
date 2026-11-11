import { describe, expect, it } from 'vitest';
import { ARTICLE_META } from '../../server/src/article-meta.js';
import {
  type ArticleLang,
  translateArticle,
  translateArticleText,
  translationKeys,
} from './article-i18n.js';
import { type Article, articles } from './articles-data.js';

const LOCALES = [
  { lang: 'zh-Hans', name: '翻翻兽棋', jungle: '斗兽棋', rules: '规则' },
  { lang: 'zh-Hant', name: '翻翻獸棋', jungle: '鬥獸棋', rules: '規則' },
] satisfies { lang: ArticleLang; name: string; jungle: string; rules: string }[];

const NOTATION_CITATION =
  '[A notation for jieqi and banqi](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Proposes a way to record these games, which does not otherwise exist. Background only.';

function bySlug(slug: string): Article {
  const article = articles.find((entry) => entry.slug === slug);
  if (!article) throw new Error(`missing article ${slug}`);
  return article;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function markdownUrls(text: string): string[] {
  return [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
}

describe('Flip Jungle article naming', () => {
  for (const { lang, name, jungle, rules } of LOCALES) {
    it(`${lang}: titles, card labels and play buttons use the animal-game name`, () => {
      const article = translateArticle(bySlug('flip-jungle-skill-ceiling'), lang);
      expect(article.title).toMatch(new RegExp(`^${name}：`));
      expect(article.cardTitle).toBe(`${name}的棋力上限`);
      expect(article.seoTitle).toMatch(new RegExp(`^${name}的棋力`));
      expect(translateArticleText(lang, 'FLIP JUNGLE')).toBe(name);
      expect(translateArticleText(lang, 'Flip Jungle rules')).toBe(`${name}${rules}`);
      expect(translateArticleText(lang, 'Play Jungle Flip')).toBe(`下${name}`);
    });

    it(`${lang}: every translated animal-game reference keeps its links and locale`, () => {
      const keys = translationKeys(lang).filter((key) =>
        /flip jungle|jungle flip|jungle’s flip variant/i.test(key),
      );
      // Includes moved-post tablebase comparisons and references in other articles.
      expect(keys.length).toBeGreaterThanOrEqual(29);
      for (const key of keys) {
        const translated = translateArticleText(lang, key);
        expect(translated, key).toContain(name);
        expect(translated, key).not.toContain('翻翻棋');
        expect(markdownUrls(translated), key).toEqual(markdownUrls(key));
      }
    });

    it(`${lang}: translated article bodies distinguish Jungle from Flip Jungle`, () => {
      for (const slug of [
        'jungle-flip',
        'flip-jungle-skill-ceiling',
        'skill-vs-luck',
        'dou-shou-qi-engine',
        'set-up-your-board',
      ]) {
        const text = strings(translateArticle(bySlug(slug), lang)).join('\n');
        expect(text.includes(name), `${slug} names Flip Jungle`).toBe(true);
        expect(text.includes('翻翻棋'), `${slug} has no old animal-game name`).toBe(false);
      }
      const rulesText = strings(translateArticle(bySlug('jungle-flip'), lang)).join('\n');
      expect(rulesText).toContain(`[${jungle}](/rules/jungle)`);
    });

    it(`${lang}: generated server titles use the same name`, () => {
      const locale = lang === 'zh-Hans' ? 'zh-hans' : 'zh-hant';
      for (const slug of ['jungle-flip', 'flip-jungle-skill-ceiling']) {
        expect(ARTICLE_META[slug].zhTitles?.[locale], slug).toMatch(new RegExp(`^${name}`));
      }
    });

    it(`${lang}: Tencent's notation citation retains its published game name`, () => {
      const title =
        lang === 'zh-Hans'
          ? '《天天象棋》揭棋和翻翻棋的记谱法'
          : '《天天象棋》揭棋和翻翻棋的記譜法';
      const translated = translateArticleText(lang, NOTATION_CITATION);
      expect(translated).toContain(`[${title}](https://zhuanlan.zhihu.com/p/638758588)`);
      expect(translated).not.toContain(name);
      expect(translated).not.toContain('暗棋');
      expect(strings(translateArticle(bySlug('jieqi-openings'), lang))).toContain(translated);
    });
  }

  it('preserves the original citation in English and the Vietnamese derivative', () => {
    expect(strings(bySlug('jieqi-openings'))).toContain(NOTATION_CITATION);
    expect(strings(bySlug('khai-cuoc-co-up'))).toContain(
      '[Một cách ghi biên bản cho cờ úp và cờ lật](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Đề xuất một cách ghi lại các ván cờ này, thứ vốn chưa tồn tại. Chỉ mang tính tham khảo.',
    );
  });
});
