import {
  endgameEntryFen,
  endgameHubEntry,
  XIANGQI_ENDGAME_HUB,
  XIANGQI_ENDGAME_HUB_CHECKS,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { translateArticle } from '../article-i18n.js';
import {
  XIANGQI_ENDGAMES_EXERCISE_ID,
  xiangqiEndgamesArticle,
} from './content/xiangqi-endgames.js';
import type { TableBlock } from './types.js';
import {
  ENDGAME_PAGE_TEXT,
  ENDGAME_PROD_CHAPTERS,
  ENDGAME_SET_STUDY_IDS,
  ENDGAME_TABLE,
  ENDGAME_TABLE_EXTRA_CHECKS,
  endgamePracticeSetOf,
  endgameStudyHref,
  endgameTableResult,
} from './xiangqi-endgames-text.js';

// The 象棋残局 page's claims: every result in the table is the database's result
// for that exact position, and every link lands on that position.

function tables(lang: 'en' | 'zh-Hans' | 'zh-Hant'): TableBlock[] {
  const article = lang === 'en' ? xiangqiEndgamesArticle : translateArticle(xiangqiEndgamesArticle, lang);
  return (article.sections ?? [])
    .flatMap((section) => section.blocks ?? [])
    .filter((block): block is TableBlock => block.kind === 'table');
}

describe('xiangqi endgames table', () => {
  it('shows 33 distinct positions: the 26 hub rows plus the seven checked extras', () => {
    const ids = ENDGAME_TABLE.map((row) => row.id);
    expect(ids).toHaveLength(33);
    expect(new Set(ids).size).toBe(33);
    const hubIds = XIANGQI_ENDGAME_HUB.map((row) => row.id);
    for (const id of hubIds) expect(ids).toContain(id);
    expect(ids.filter((id) => !hubIds.includes(id)).sort()).toEqual(
      ENDGAME_TABLE_EXTRA_CHECKS.map((check) => check.id).sort(),
    );
  });

  it("states each position's own database result", () => {
    for (const row of ENDGAME_TABLE) {
      const check =
        XIANGQI_ENDGAME_HUB_CHECKS.find((candidate) => candidate.id === row.id) ??
        ENDGAME_TABLE_EXTRA_CHECKS.find((candidate) => candidate.id === row.id);
      expect(check, `${row.id}: no check`).toBeDefined();
      const shown = endgameTableResult(row.id) === 'draw' ? 'draw' : 'win';
      expect(check?.result, row.id).toBe(shown);
      // And the corpus, which the practice chapter is built from, agrees.
      expect(endgameHubEntry(row.id).verdict, row.id).toBe(shown);
    }
  });

  it('records a mate distance for every extra win and none for a draw', () => {
    for (const check of ENDGAME_TABLE_EXTRA_CHECKS) {
      if (check.result === 'win') expect(check.distance, check.id).toBeGreaterThan(0);
      else expect(check.distance, check.id).toBeNull();
    }
  });

  it('holds every recorded prod chapter to the corpus position, in the set that holds it', () => {
    for (const [id, chapter] of Object.entries(ENDGAME_PROD_CHAPTERS)) {
      expect(chapter.rootFen, id).toBe(endgameEntryFen(endgameHubEntry(id)));
      expect(chapter.study, id).toBe(ENDGAME_SET_STUDY_IDS[endgamePracticeSetOf(id)]);
    }
  });

  it('links each row to its chapter, or to the set that will hold it', () => {
    for (const row of ENDGAME_TABLE) {
      const set = ENDGAME_SET_STUDY_IDS[endgamePracticeSetOf(row.id)];
      const chapter = ENDGAME_PROD_CHAPTERS[row.id];
      expect(endgameStudyHref(row.id), row.id).toBe(
        chapter ? `/study/${set}/${chapter.chapter}` : `/study/${set}`,
      );
    }
  });

  it('renders the same rows, with the same links, in all three scripts', () => {
    const counts = (lang: 'en' | 'zh-Hans' | 'zh-Hant') => tables(lang).map((table) => table.rows.length);
    expect(counts('en')).toEqual([12, 5, 5, 8, 3]);
    expect(counts('zh-Hans')).toEqual(counts('en'));
    expect(counts('zh-Hant')).toEqual(counts('en'));
    const hrefs = (lang: 'en' | 'zh-Hans' | 'zh-Hant') =>
      tables(lang).flatMap((table) => table.rows.map((row) => /\]\(([^)]+)\)$/.exec(row[0] ?? '')?.[1]));
    expect(hrefs('en')).toEqual(ENDGAME_TABLE.map((row) => endgameStudyHref(row.id)));
    expect(hrefs('zh-Hans')).toEqual(hrefs('en'));
    expect(hrefs('zh-Hant')).toEqual(hrefs('en'));
    // No English left in a zh table body.
    for (const lang of ['zh-Hans', 'zh-Hant'] as const) {
      for (const table of tables(lang)) {
        for (const row of table.rows) {
          expect(row[0]?.replace(/\]\([^)]*\)$/, ''), row[0]).not.toMatch(/[A-Za-z]{3,}/);
          expect(row[1], row[1]).not.toMatch(/[A-Za-z]/);
        }
      }
    }
  });

  it('names 象棋残局 in the zh titles', () => {
    for (const lang of ['zh-Hans', 'zh-Hant'] as const) {
      const title = ENDGAME_PAGE_TEXT.title[lang];
      const seo = ENDGAME_PAGE_TEXT.seoTitle[lang];
      const name = lang === 'zh-Hans' ? '象棋残局' : '象棋殘局';
      expect(title.startsWith(name), title).toBe(true);
      expect(seo.startsWith(name), seo).toBe(true);
    }
  });

  it('sends the exercise to a chapter that already exists on prod', () => {
    expect(ENDGAME_PROD_CHAPTERS[XIANGQI_ENDGAMES_EXERCISE_ID]).toBeDefined();
    // Red to move, and the database's mate is five Red moves, as the page says.
    const check = XIANGQI_ENDGAME_HUB_CHECKS.find((row) => row.id === XIANGQI_ENDGAMES_EXERCISE_ID);
    expect(check?.result).toBe('win');
    expect(check?.distance).toBe(9);
    expect(ENDGAME_PAGE_TEXT.exerciseCaption.en).toContain('mate in five');
  });
});
