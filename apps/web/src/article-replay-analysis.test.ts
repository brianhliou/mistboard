import { describe, expect, it } from 'vitest';
import {
  articleAnalysisKey,
  articleAnalysisKeys,
  articleAnalysisLoader,
} from './article-replay-analysis.js';
import {
  ARTICLE_ANALYSIS_EXEMPT_SLUGS,
  articleReplayRecords,
} from './article-replay-analysis-coverage.js';
import { articles } from './articles-data.js';

// Every xiangqi game on an article draws the advantage chart: from the broadcast
// archive when the spec has a boardId, else from a precomputed file keyed by the
// record. These tests are what stops a new or regenerated article from silently
// losing its chart: a game with neither fails here, naming the board and the
// command that fixes it.

const FIX = 'run scripts/article-chart-analysis.mjs (header has the env) and commit the file';
// The archive's own analysis (apps/server/src/xiangqi-analysis.ts): one engine
// pass for every chart on the site.
const ENGINE_ID = 'pikafish-xiangqi-analysis@5';

const records = articleReplayRecords(articles);
const plies = (iccs: string) => iccs.trim().split(/\s+/).filter(Boolean).length;
const label = (r: (typeof records)[number]) => `${r.slug}: ${r.spec.red} vs ${r.spec.black}`;

describe('articleAnalysisKey', () => {
  const record = { iccs: 'h2e2 h9g7 h0g2 i9h9' };

  it('is 14 hex digits and stable across whitespace in the move list', () => {
    const key = articleAnalysisKey(record);
    expect(key).toMatch(/^[0-9a-f]{14}$/);
    expect(articleAnalysisKey({ iccs: '  h2e2  h9g7\nh0g2 i9h9 ' })).toBe(key);
  });

  it('changes with any move or the start position', () => {
    const key = articleAnalysisKey(record);
    expect(articleAnalysisKey({ iccs: 'h2e2 h9g7 h0g2' })).not.toBe(key);
    expect(articleAnalysisKey({ iccs: 'h2e2 h9g7 h0g2 b9c7' })).not.toBe(key);
    expect(
      articleAnalysisKey({
        ...record,
        startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
      }),
    ).not.toBe(key);
  });
});

describe('article boards and their charts', () => {
  const games = records.filter((r) => r.chart === 'static');

  it('finds the article games (an enumeration that went empty would pass everything below)', () => {
    // 2026-10-08: 30 boards without a board id (29 tournament games and the
    // 1632 manual line on the xiangqi rules page), 17+ with one.
    expect(games.length).toBeGreaterThanOrEqual(30);
    expect(records.filter((r) => r.chart === 'archive').length).toBeGreaterThanOrEqual(17);
  });

  it('every game without a board id has a precomputed analysis file', () => {
    const missing = games.filter((r) => !articleAnalysisLoader(r.spec)).map(label);
    expect(missing, `no analysis file: ${FIX}`).toEqual([]);
  });

  it('every file covers its record ply for ply, from the archive engine', async () => {
    for (const record of games) {
      const load = articleAnalysisLoader(record.spec);
      if (!load) continue; // reported by the test above
      const body = await load();
      const name = `${label(record)} (${articleAnalysisKey(record.spec)}.json)`;
      expect(body.engineId, name).toBe(ENGINE_ID);
      expect(body.plies.length, `${name}: ${FIX}`).toBe(plies(record.spec.iccs) + 1);
      expect(
        body.plies.every((p, i) => p.ply === i),
        name,
      ).toBe(true);
    }
  });

  it('ships no file that no article board uses', () => {
    const used = new Set(games.map((r) => articleAnalysisKey(r.spec)));
    expect(articleAnalysisKeys().filter((key) => !used.has(key))).toEqual([]);
  });

  it('leaves out only positions (a start FEN) and the exempt non-xiangqi articles', () => {
    for (const r of records.filter((x) => x.chart === 'none')) {
      expect(Boolean(r.spec.startFen) || r.slug in ARTICLE_ANALYSIS_EXEMPT_SLUGS, label(r)).toBe(
        true,
      );
    }
    for (const slug of Object.keys(ARTICLE_ANALYSIS_EXEMPT_SLUGS)) {
      expect(
        articles.some((a) => a.slug === slug),
        `${slug} is exempt but no longer exists`,
      ).toBe(true);
    }
  });
});
