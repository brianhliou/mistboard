import {
  endgameEntryFen,
  endgameEntryState,
  endgameHubEntry,
  XIANGQI_ENDGAME_CORPUS,
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
import { XQ_ALL_SQUARES } from './diagrams.js';
import {
  ENDGAME_GRADE_GLOSSARY,
  ENDGAME_PAGE_TEXT,
  ENDGAME_PROD_CHAPTERS,
  ENDGAME_SET_STUDY_IDS,
  ENDGAME_TABLE,
  ENDGAME_TABLE_EXTRA_CHECKS,
  endgameDiagramLabel,
  endgamePositionResult,
  endgamePracticeSetOf,
  endgameStudyHref,
  endgameTableResult,
} from './xiangqi-endgames-text.js';

// The 象棋残局 page's claims: every result in the table is the database's result
// for that exact position, and every link lands on that position.

function allTables(lang: 'en' | 'zh-Hans' | 'zh-Hant'): TableBlock[] {
  const article = lang === 'en' ? xiangqiEndgamesArticle : translateArticle(xiangqiEndgamesArticle, lang);
  return (article.sections ?? [])
    .flatMap((section) => section.blocks ?? [])
    .filter((block): block is TableBlock => block.kind === 'table');
}

/** The endgame tables: the ones whose rows lead with a board. */
function tables(lang: 'en' | 'zh-Hans' | 'zh-Hant'): TableBlock[] {
  return allTables(lang).filter((table) => table.rowDiagrams);
}

describe('xiangqi endgames table', () => {
  it('shows 35 distinct positions: the 26 hub rows plus the nine checked extras', () => {
    const ids = ENDGAME_TABLE.map((row) => row.id);
    expect(ids).toHaveLength(35);
    expect(new Set(ids).size).toBe(35);
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
      const shown = endgamePositionResult(row.id);
      expect(check?.result, row.id).toBe(shown);
      // And the corpus, which the practice chapter is built from, agrees.
      expect(endgameHubEntry(row.id).verdict, row.id).toBe(shown);
    }
  });

  it('shows a 难胜 row at its holding setup, and checks the one-step loss its idea cites', () => {
    const hard = ENDGAME_TABLE.filter((row) => endgameTableResult(row.id) === 'hard-win');
    expect(hard.map((row) => row.id)).toEqual(['chariot-vs-two-minor-pieces']);
    for (const check of ENDGAME_TABLE_EXTRA_CHECKS) {
      if (!check.contrast) continue;
      const row = ENDGAME_TABLE.find((candidate) => candidate.id === check.id);
      expect(check.result, check.id).toBe('draw');
      // The contrast is a corpus position the database calls a win, and the
      // idea quotes its mate in Red moves.
      const contrast = XIANGQI_ENDGAME_CORPUS.find((entry) => entry.id === check.contrast?.id);
      expect(contrast?.verdict, check.contrast.id).toBe('win');
      const moves = Math.ceil(check.contrast.distance / 2);
      expect(row?.idea?.en, check.id).toContain(`Red mates in ${moves}.`);
    }
    expect(ENDGAME_TABLE_EXTRA_CHECKS.filter((check) => check.contrast)).toHaveLength(2);
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
    expect(counts('en')).toEqual([12, 5, 5, 9, 4]);
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

  it("leads every row with a board drawn from that row's own position", () => {
    for (const lang of ['en', 'zh-Hans', 'zh-Hant'] as const) {
      const shown = tables(lang).flatMap((table) => {
        expect(table.rowDiagrams?.length, `${lang}: one board per row`).toBe(table.rows.length);
        return table.rowDiagrams ?? [];
      });
      expect(shown).toHaveLength(ENDGAME_TABLE.length);
      shown.forEach((diagram, i) => {
        const row = ENDGAME_TABLE[i]!;
        // Its accessible name is the row's material and result, in the page's script.
        expect(diagram.label, row.id).toBe(endgameDiagramLabel(row)[lang]);
        if (lang !== 'en') expect(diagram.label, row.id).not.toMatch(/[A-Za-z]{3,}/);
        // Every piece on the board is a piece of the position, on its square,
        // and nothing else is drawn as a piece.
        const svg = diagram.svg();
        const state = endgameEntryState(endgameHubEntry(row.id));
        const drawn = [...svg.matchAll(/data-piece-square="([a-i]\d+)"/g)].map((m) => m[1]).sort();
        const expected = XQ_ALL_SQUARES.filter((sq) => state.board[sq]).sort();
        expect(drawn, row.id).toEqual(expected);
        // And those are the squares the row's FEN occupies (its first field,
        // rank 10 first, digits for empty points).
        const placement = endgameEntryFen(endgameHubEntry(row.id)).split(' ')[0] ?? '';
        const fenSquares = placement.split('/').flatMap((rank, r) => {
          const squares: string[] = [];
          let file = 0;
          for (const ch of rank) {
            if (/\d/.test(ch)) file += Number(ch);
            else squares.push(`${'abcdefghi'[file++]}${10 - r}`);
          }
          return squares;
        });
        expect(drawn, row.id).toEqual(fenSquares.sort());
      });
    }
  });

  it('keeps each board lean (under 9 KB of markup)', () => {
    for (const table of tables('en')) {
      for (const diagram of table.rowDiagrams ?? []) {
        expect(diagram.svg().length).toBeLessThan(9000);
      }
    }
  });

  it('glosses all six grades in every script, ahead of the endgame tables', () => {
    for (const lang of ['en', 'zh-Hans', 'zh-Hant'] as const) {
      const [glossary, ...rest] = allTables(lang);
      expect(glossary?.rowDiagrams, lang).toBeUndefined();
      expect(rest).toHaveLength(5);
      expect(glossary?.rows.map((row) => row[0]), lang).toEqual(
        ENDGAME_GRADE_GLOSSARY.map((entry) => entry.grade[lang]),
      );
      if (lang !== 'en') {
        for (const row of glossary?.rows ?? []) expect(row.join(''), lang).not.toMatch(/[A-Za-z]/);
      }
    }
  });

  it('carries "xiangqi basic endgames" in the English titles', () => {
    for (const title of [ENDGAME_PAGE_TEXT.title.en, ENDGAME_PAGE_TEXT.seoTitle.en, xiangqiEndgamesArticle.title]) {
      expect(title.toLowerCase(), title).toContain('xiangqi basic endgames');
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
