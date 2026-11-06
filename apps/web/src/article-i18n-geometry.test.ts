import { assertValidBanqiDeal, assertValidJieqiDeal } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { ARTICLE_GEOMETRY_KEYS, type ArticleLang, translateArticle } from './article-i18n.js';
import { articles } from './articles-data.js';

// The zh render deep-translates every string in an article. On 2026-10-11 the
// banqi chase article added bare role names (advisor, general, ...) as dictionary
// keys for its labels, and the deal of every jieqi and banqi replay on a zh page
// turned into 士/将 roles: the deal check threw on /zh-hans/blog/jieqi-platform
// and /zh-hans/blog/mistybanqi (PostHog error tracking, 2026-10-13).
const LANGS: ArticleLang[] = ['zh-Hans', 'zh-Hant'];

function geometry(value: unknown, key?: string, out: unknown[] = []): unknown[] {
  if (key && ARTICLE_GEOMETRY_KEYS.has(key)) {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) for (const v of value) geometry(v, key, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) geometry(v, k, out);
  }
  return out;
}

function replayBlocks(value: unknown, out: Array<{ kind: string; deal: unknown }> = []) {
  if (Array.isArray(value)) for (const v of value) replayBlocks(v, out);
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const spec = record.spec as Record<string, unknown> | undefined;
    if ((record.kind === 'jieqi-replay' || record.kind === 'banqi-replay') && spec?.deal) {
      out.push({ kind: record.kind, deal: spec.deal });
    }
    for (const v of Object.values(record)) replayBlocks(v, out);
  }
  return out;
}

describe('zh article translation leaves board geometry alone', () => {
  for (const lang of LANGS) {
    it(`${lang}: every geometry field is unchanged`, () => {
      for (const article of articles) {
        const translated = translateArticle(article, lang);
        expect(geometry(translated), article.slug).toEqual(geometry(article));
      }
    });

    it(`${lang}: every jieqi and banqi replay deal stays valid`, () => {
      const blocks = articles.flatMap((article) => replayBlocks(translateArticle(article, lang)));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        if (block.kind === 'jieqi-replay') {
          expect(() => assertValidJieqiDeal(block.deal as never)).not.toThrow();
        } else {
          expect(() => assertValidBanqiDeal(block.deal as never)).not.toThrow();
        }
      }
    });
  }
});
