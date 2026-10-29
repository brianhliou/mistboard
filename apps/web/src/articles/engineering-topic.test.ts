// Substantial code means an engineering post (Brian, 2026-10-28: "Any post or
// blog post that we have, and we show code in significant amounts of code, it
// should be labeled as an engineering post."). Engineering posts sit under the
// blog's Engineering chip, off the homepage rows, and carry the Engineering
// label on their meta row; a player should not land on a page of source
// thinking it is a guide.
//
// The threshold is 10 lines of real code across an article's code blocks. On
// 2026-10-28 the untagged articles with code blocks measured 0 (fog-openings,
// a move list), 4 (solver-audit, a DhtmlXQ record plus solver messages), 7
// (skill-vs-luck, pseudocode and two formulas), then 13 (helpmates
// pseudocode), 15 (horde-xiangqi engine config), 17 (mistybanqi Rust) and 24
// (jungle-den-term Rust). 10 sits in the gap between 7 and 13, so a short
// formula or outline stays a player post and a real listing does not.
//
// Real code is every non-blank line of a code block except notation: a line
// carrying a FEN, a numbered move-list line, a line of a game record's digits
// or a bare [Tag] header, and a line with no ASCII at all (a record's Chinese
// comment). Known blind spots, left on purpose and pinned below: prose inside
// a code block (solver output, a trailing remark) counts as code, and a config
// line whose value is a FEN is dropped with the FEN.

import { describe, expect, it } from 'vitest';
import { isArticleTranslationPublished } from '../article-i18n.js';
import { buildArticlePage } from '../articles.js';
import { articles } from '../articles-data.js';
import type { Article } from './types.js';

export const ENGINEERING_CODE_LINES = 10;

// Over the line but kept for every reader, by Brian's call (2026-10-28:
// "helpmates and horde i think no. helpmates is not player, it's general"):
// the code there supports a piece about the game, not about how we built it.
// A slug goes here only with Brian's words beside it.
export const NOT_ENGINEERING_DESPITE_CODE: Readonly<Record<string, string>> = {
  'helpmates-in-xiangqi': 'Brian 2026-10-28: a general piece; the pseudocode supports the problems',
  'horde-xiangqi': 'Brian 2026-10-28: a variant piece; the engine config is a sidebar',
};

// A FEN: at least eight ranks of piece letters and digits joined by slashes.
const FEN_TOKEN = /(?:^|\s|=)[1-9A-Za-z]{1,10}(?:\/[1-9A-Za-z]{1,10}){7,}(?=\s|$)/;
// "1. c4", "41  Red tiger d6 -> d5": a numbered move.
const MOVE_LINE = /^\s*\d+\.{0,3}\s/;
// DhtmlXQ-style record data: digit groups only, or a lone [Tag].
const RECORD_DATA = /^\s*(?:[\d\s]+|\[[A-Za-z0-9_]+\])\s*$/;

function isCodeLine(line: string): boolean {
  if (!line.trim()) return false;
  if (FEN_TOKEN.test(line)) return false;
  if (MOVE_LINE.test(line)) return false;
  if (RECORD_DATA.test(line)) return false;
  if (!/[\x21-\x7e]/.test(line)) return false;
  return true;
}

export function realCodeLines(text: string): number {
  return text.split('\n').filter(isCodeLine).length;
}

function codeBlockTexts(article: Article): string[] {
  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.kind === 'code' && typeof node.text === 'string') {
      texts.push(node.text);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(article.intro);
  walk(article.sections);
  return texts;
}

export function articleCodeLines(article: Article): number {
  return codeBlockTexts(article).reduce((sum, text) => sum + realCodeLines(text), 0);
}

/** Published articles over the threshold that are not tagged engineering. */
export function untaggedCodeHeavyArticles(list: readonly Article[]): string[] {
  return list
    .filter(
      (article) =>
        article.kind === 'article' &&
        article.status === 'published' &&
        article.topic !== 'engineering' &&
        !(article.slug in NOT_ENGINEERING_DESPITE_CODE) &&
        articleCodeLines(article) >= ENGINEERING_CODE_LINES,
    )
    .map((article) => `${article.slug} (${articleCodeLines(article)} lines of code)`);
}

const TS_LISTING = [
  'export function winRate(cp: number): number {',
  '  return 1 / (1 + 10 ** (-cp / 400));',
  '}',
  '',
  'export function isBlunder(before: number, after: number): boolean {',
  '  const drop = winRate(before) - winRate(after);',
  '  if (drop < 0.25) return false;',
  '  return winRate(before) < 0.9;',
  '}',
  '',
  'for (const ply of plies) {',
  '  if (isBlunder(ply.before, ply.after)) candidates.push(ply);',
  '}',
].join('\n');

const FEN_BLOCK = Array.from(
  { length: 12 },
  (_, i) => `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR ${i % 2 ? 'b' : 'w'} - - 0 1`,
).join('\n');

function fixture(overrides: Partial<Article> & { text: string }): Article {
  const { text, ...rest } = overrides;
  return {
    slug: 'planted',
    kind: 'article',
    publisher: 'mistboard',
    title: 'Planted',
    summary: 'A fixture.',
    status: 'published',
    audience: 'Tests.',
    sections: [{ heading: 'Code', blocks: [{ kind: 'code', language: 'typescript', text }] }],
    ...rest,
  } as Article;
}

describe('substantial code means an engineering post', () => {
  it('tags every published article with 10 or more lines of real code', () => {
    expect(untaggedCodeHeavyArticles(articles)).toEqual([]);
  });

  it('exempts only named articles that are still over the line and untagged', () => {
    for (const slug of Object.keys(NOT_ENGINEERING_DESPITE_CODE)) {
      const article = articles.find((entry) => entry.slug === slug);
      expect(article, slug).toBeDefined();
      expect(article?.kind === 'article' ? article.topic : undefined, slug).not.toBe('engineering');
      expect(articleCodeLines(article as Article), slug).toBeGreaterThanOrEqual(ENGINEERING_CODE_LINES);
    }
    expect(untaggedCodeHeavyArticles([fixture({ text: TS_LISTING, slug: 'helpmates-in-xiangqi' })])).toEqual([]);
  });

  it('catches a planted untagged article with a real listing', () => {
    const planted = fixture({ text: TS_LISTING });
    expect(articleCodeLines(planted)).toBe(11);
    expect(untaggedCodeHeavyArticles([planted])).toEqual(['planted (11 lines of code)']);
  });

  it('passes the same article once it is tagged, and ignores a draft', () => {
    expect(untaggedCodeHeavyArticles([fixture({ text: TS_LISTING, topic: 'engineering' } as Partial<Article> & { text: string })])).toEqual([]);
    expect(untaggedCodeHeavyArticles([fixture({ text: TS_LISTING, status: 'draft' })])).toEqual([]);
  });

  it('does not count a FEN-only block, a move list or a game record', () => {
    expect(realCodeLines(FEN_BLOCK)).toBe(0);
    expect(untaggedCodeHeavyArticles([fixture({ text: FEN_BLOCK })])).toEqual([]);
    expect(
      realCodeLines(
        [
          '1. c4    (anything)',
          '2. Qa4   (anything)',
          '41  Red   tiger     d6 -> d5    its only move',
          'stored  5k2/2Q4p/P2Qp3/4N3/5pP1/B7/4PP1P/RN2KB1R b KQ -  0 29',
          '[DhtmlXQ_binit]',
          '72999999 59999957 22771799 99999941',
          '红弃双车，双炮胜',
        ].join('\n'),
      ),
    ).toBe(0);
  });

  it('pins its blind spots: prose in a code block counts, a FEN-valued config line does not', () => {
    expect(realCodeLines('remove the black chariot on e2')).toBe(1);
    expect(realCodeLines('startFen = rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toBe(0);
  });

  it('measures the articles the threshold was set from', () => {
    const lines = (slug: string): number => {
      const article = articles.find((entry) => entry.slug === slug);
      if (!article) throw new Error(`missing article ${slug}`);
      return articleCodeLines(article);
    };
    expect({
      'fog-openings': lines('fog-openings'),
      'solver-audit': lines('solver-audit'),
      'skill-vs-luck': lines('skill-vs-luck'),
      'helpmates-in-xiangqi': lines('helpmates-in-xiangqi'),
      'horde-xiangqi': lines('horde-xiangqi'),
      mistybanqi: lines('mistybanqi'),
      'jungle-den-term': lines('jungle-den-term'),
    }).toEqual({
      'fog-openings': 0,
      'solver-audit': 4,
      'skill-vs-luck': 7,
      'helpmates-in-xiangqi': 13,
      'horde-xiangqi': 15,
      mistybanqi: 17,
      'jungle-den-term': 24,
    });
  });
});

describe('the Engineering label on an article page', () => {
  it('links an engineering post to the Engineering filter', () => {
    const label = buildArticlePage('how-puzzle-mining-works').querySelector<HTMLAnchorElement>(
      '.article-meta-row .article-topic-label',
    );
    expect(label?.textContent).toBe('Engineering');
    expect(label?.getAttribute('href')).toBe('/blog?topic=engineering');
  });

  it('is localized on a translated engineering post', () => {
    const slug = articles.find(
      (article) =>
        article.kind === 'article' &&
        article.topic === 'engineering' &&
        article.status === 'published' &&
        isArticleTranslationPublished(article.slug),
    )?.slug;
    if (!slug) throw new Error('no translated engineering post to check');
    const label = buildArticlePage(slug, 'zh-Hans').querySelector<HTMLAnchorElement>('.article-topic-label');
    expect(label?.textContent).toBe('技术');
    expect(label?.getAttribute('href')).toMatch(/topic=engineering/);
    expect(label?.getAttribute('href')).not.toBe('/blog?topic=engineering');
  });

  it('is absent on a post for players', () => {
    expect(buildArticlePage('skill-vs-luck').querySelector('.article-topic-label')).toBeNull();
  });
});
