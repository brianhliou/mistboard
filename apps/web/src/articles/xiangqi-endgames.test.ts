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
import { resolvePracticeChapterHref } from '../practice-chapter-redirect.js';
import {
  XIANGQI_ENDGAMES_EXERCISE_ID,
  xiangqiEndgamesArticle,
} from './content/xiangqi-endgames.js';
import type { TableBlock } from './types.js';
import { XQ_ALL_SQUARES } from './diagrams.js';
import {
  ENDGAME_GRADE_GLOSSARY,
  ENDGAME_PAGE_TEXT,
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

/** The five sets' study ids on prod (GET /api/practice, read 2026-10-14). */
const PROD_SET_STUDY_IDS: Record<string, string> = {
  'endgames-soldier': 'DstCTARw',
  'endgames-chariot': 'hc6LmrOG',
  'endgames-horse': 'PNqQaTM6',
  'endgames-cannon': 'rj3D8rMs',
  'endgames-insufficient': 'feCqSlEw',
};

/**
 * Every table row's chapter on prod as [study, chapter, root FEN], read from
 * GET /api/studies/:id on 2026-10-14. The 22 rows the page linked by id on
 * 2026-10-07 have the same chapter ids here; the other 13 linked their set
 * then and are chapters now. The links no longer carry these ids (#521): this
 * is prod as a fixture, to hold the slug lookup to the chapters prod links
 * opened.
 */
const PROD_CHAPTERS: Record<string, [study: string, chapter: string, rootFen: string]> = {
  'high-soldier-vs-bare-general': ['DstCTARw', 'oHs6Af2z', '5k3/9/3P5/9/9/9/9/9/9/4K4 r - - 0 1'],
  'high-soldier-vs-advisor-tricky': ['DstCTARw', 'vGxV0Ejd', '4ka3/9/5P3/9/9/9/9/9/9/3K5 r - - 0 1'],
  'high-low-soldiers-vs-two-advisors': ['DstCTARw', 'Pp2Y5QX7', '3aka3/6P2/2P6/9/9/9/9/9/9/3K5 r - - 0 1'],
  'two-soldiers-vs-two-elephants': ['DstCTARw', 'NraxgqiY', '2b1k1b2/9/9/9/3P1P3/9/9/9/9/3K5 r - - 0 1'],
  'three-soldiers-vs-horse-and-two-advisors': ['DstCTARw', 'fjcDdHLP', '3aka3/9/4n4/2P1P1P2/9/9/9/9/9/4K4 r - - 0 1'],
  'two-high-soldiers-vs-cannon': ['DstCTARw', 'GBo3Zj7D', '4k4/4c4/9/2P3P2/9/9/9/9/9/4K4 r - - 0 1'],
  'two-soldiers-vs-two-advisors': ['DstCTARw', 'hjxe7Knl', '3aka3/9/9/9/3P1P3/9/9/9/9/3K5 r - - 0 1'],
  'three-soldiers-vs-cannon-and-two-elephants': ['DstCTARw', 'bEx7oNV5', '2b1k1b2/9/9/2P1P1P2/9/4c4/9/9/9/4K4 r - - 0 1'],
  'three-soldiers-vs-full-defence': ['DstCTARw', 'aRL5w6iC', '2b1ka3/4a4/4b4/2P1P1P2/9/9/9/9/9/4K4 r - - 0 1'],
  'high-soldier-vs-advisor': ['DstCTARw', 'mipS3HQp', '4k4/4a4/9/4P4/9/9/9/9/4K4/9 r - - 0 1'],
  'two-soldiers-vs-advisor-and-elephant': ['DstCTARw', 'CHi4AJpE', '2b1k4/4a4/9/9/3P1P3/9/9/9/9/4K4 r - - 0 1'],
  'chariot-cannon-vs-chariot-center': ['hc6LmrOG', 'QeEzHDn2', '5k3/9/9/9/r8/2C1R4/9/9/9/4K4 r - - 0 1'],
  'chariot-vs-three-defence': ['hc6LmrOG', 'aAF1ooTw', '4ka3/4a4/4b4/9/9/4R4/9/9/9/4K4 r - - 0 1'],
  'chariot-vs-cannon-two-advisors-tricky': ['hc6LmrOG', 'wJl8mN65', '3aka3/9/4c4/9/9/9/7R1/9/9/4K4 r - - 0 1'],
  'chariot-vs-full-defence-tricky': ['hc6LmrOG', 'CtNXlj6f', '4ka3/4a4/b7b/9/1R7/9/9/9/9/3K5 r - - 0 1'],
  'chariot-vs-horse-two-advisors': ['hc6LmrOG', 'O93RRzSn', '3aka3/9/2n6/9/9/R8/9/9/9/5K3 r - - 0 1'],
  'chariot-vs-full-defence': ['hc6LmrOG', 'MyIZ3XSd', '2b1ka3/4a4/4b4/9/9/4R4/9/9/9/4K4 r - - 0 1'],
  'chariot-vs-horse-two-elephants-fortress': ['hc6LmrOG', 'zsSsZLbq', '4k4/9/4n3b/4R4/6b2/9/9/9/4K4/9 r - - 0 1'],
  'chariot-vs-cannon-two-advisors': ['hc6LmrOG', 'uAuI4PjG', '4ka3/4a4/9/3c5/9/9/9/9/3K5/7R1 r - - 0 1'],
  'chariot-vs-two-minor-pieces': ['hc6LmrOG', 'hIZwpqop', '5c3/5k3/9/3n5/9/R8/9/9/9/4K4 r - - 0 1'],
  'chariot-cannon-vs-chariot': ['hc6LmrOG', 'GoeeVBgU', '5k3/9/9/9/9/R1C1r4/9/9/9/3K5 r - - 0 1'],
  'two-chariots-vs-chariot-full-defence': ['hc6LmrOG', 'HJWlVc5G', '2b1ka3/4a4/r3b4/9/9/3R1R3/9/9/9/4K4 r - - 0 1'],
  'horse-vs-elephant-zugzwang': ['PNqQaTM6', 'jeCJgZEG', '3k5/9/5N3/9/2b6/9/9/9/4K4/9 r - - 0 1'],
  'horse-and-soldier-vs-three-defence': ['PNqQaTM6', 'mmiG3IsB', '4ka3/4a4/4b4/9/4P4/4N4/9/9/9/4K4 r - - 0 1'],
  'horse-vs-advisor': ['PNqQaTM6', 'uJQcVSvn', '3ak4/9/9/9/9/4N4/9/9/9/4K4 r - - 0 1'],
  'two-horses-vs-full-defence': ['PNqQaTM6', 'E8vYqhoQ', '2b1ka3/4a4/4b4/9/9/3N1N3/9/9/9/4K4 r - - 0 1'],
  'horse-vs-elephant': ['PNqQaTM6', 'M5LYB24C', '2b1k4/9/9/9/9/4N4/9/9/9/4K4 r - - 0 1'],
  'horse-vs-crossed-soldier': ['PNqQaTM6', 'zcohFocD', '4k4/9/9/9/N8/9/3p5/9/9/5K3 r - - 0 1'],
  'horse-and-soldier-vs-full-defence': ['PNqQaTM6', 'HUojqblI', '2b1ka3/4a4/4b4/9/4P4/4N4/9/9/9/4K4 r - - 0 1'],
  'cannon-and-advisor-vs-two-advisors': ['rj3D8rMs', '8AI7kOXl', '3k5/4a4/3a5/9/9/9/9/3A1K3/9/3C5 r - - 0 1'],
  'two-cannons-advisor-vs-full-defence': ['rj3D8rMs', 'UTndoCk5', '2b1ka3/4a4/4b4/9/9/1C5C1/9/9/4A4/4K4 r - - 0 1'],
  'two-cannons-vs-two-elephants': ['rj3D8rMs', '0schi3Bh', '2b1k1b2/9/9/9/9/1C5C1/9/9/9/3K5 r - - 0 1'],
  'cannon-and-full-defence-vs-full-defence': ['rj3D8rMs', 'hDZE0K9k', '2b1ka3/4a4/4b4/9/9/4C4/9/4B4/4A4/2BAK4 r - - 0 1'],
  'bottom-soldier-vs-bare-general': ['feCqSlEw', 'ZrpoFvus', '2P6/3k5/9/9/9/9/9/9/9/4K4 r - - 0 1'],
  'cannon-vs-bare-general': ['feCqSlEw', '3VUGq3dJ', '4k4/9/9/9/9/4C4/9/9/9/4K4 r - - 0 1'],
};

/** /api/practice and /api/studies/:id as a database holding `chapters` serves them. */
function fakeApi(
  sets: Record<string, string>,
  chapters: Record<string, [string, string, string]>,
): (url: string) => Promise<unknown> {
  return async (url) => {
    if (url === '/api/practice') {
      return {
        sections: [
          { cards: Object.entries(sets).map(([slug, studyId]) => ({ slug, studyId })) },
        ],
      };
    }
    const studyId = /^\/api\/studies\/([A-Za-z0-9]+)$/.exec(url)?.[1];
    if (!studyId) throw new Error(`unexpected fetch ${url}`);
    return {
      chapters: Object.values(chapters)
        .filter(([study]) => study === studyId)
        .map(([, id, rootFen]) => ({ id, root: { rootFen } })),
    };
  };
}

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
    expect(Object.keys(PROD_CHAPTERS).sort()).toEqual(ENDGAME_TABLE.map((row) => row.id).sort());
    for (const [id, [study, , rootFen]] of Object.entries(PROD_CHAPTERS)) {
      expect(rootFen, id).toBe(endgameEntryFen(endgameHubEntry(id)));
      expect(study, id).toBe(PROD_SET_STUDY_IDS[endgamePracticeSetOf(id)]);
    }
  });

  it("links each row by set slug and position, never by one database's ids (#521)", () => {
    for (const row of ENDGAME_TABLE) {
      expect(endgameStudyHref(row.id), row.id).toBe(
        `/practice/${endgamePracticeSetOf(row.id)}/${row.id}`,
      );
    }
  });

  it('on prod, every row opens the chapter prod holds for it', async () => {
    const prod = fakeApi(PROD_SET_STUDY_IDS, PROD_CHAPTERS);
    for (const row of ENDGAME_TABLE) {
      const [study, chapter] = PROD_CHAPTERS[row.id] ?? [];
      expect(await resolvePracticeChapterHref(endgameStudyHref(row.id), prod), row.id).toBe(
        `/study/${study}/${chapter}`,
      );
    }
  });

  it("on a local pair, every row opens that database's chapter, and a missing one its set", async () => {
    // The same sets seeded locally under other ids.
    const sets = Object.fromEntries(
      Object.keys(PROD_SET_STUDY_IDS).map((slug, index) => [slug, `local${index}`]),
    );
    const chapters = Object.fromEntries(
      Object.entries(PROD_CHAPTERS).map(([id, [, , rootFen]], index) => [
        id,
        [sets[endgamePracticeSetOf(id)] ?? '', `ch${index}`, rootFen] as [string, string, string],
      ]),
    );
    const local = fakeApi(sets, chapters);
    for (const row of ENDGAME_TABLE) {
      const [study, chapter] = chapters[row.id] ?? [];
      expect(await resolvePracticeChapterHref(endgameStudyHref(row.id), local), row.id).toBe(
        `/study/${study}/${chapter}`,
      );
    }
    // A seed that has not added the chapter yet: the link opens its set.
    const { [XIANGQI_ENDGAMES_EXERCISE_ID]: _dropped, ...rest } = chapters;
    const exercise = endgameStudyHref(XIANGQI_ENDGAMES_EXERCISE_ID);
    expect(await resolvePracticeChapterHref(exercise, fakeApi(sets, rest))).toBe(
      `/study/${sets[endgamePracticeSetOf(XIANGQI_ENDGAMES_EXERCISE_ID)]}`,
    );
    // No sets seeded at all: the shelf.
    expect(await resolvePracticeChapterHref(exercise, fakeApi({}, {}))).toBe('/practice');
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

  // 9 KB until 2026-10-08; the piece shadow (xiangqiPieceShadowMarks) adds
  // about 165 bytes per piece, 9.9 KB on the busiest row board.
  it('keeps each board lean (under 11 KB of markup)', () => {
    for (const table of tables('en')) {
      for (const diagram of table.rowDiagrams ?? []) {
        expect(diagram.svg().length).toBeLessThan(11000);
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
    expect(PROD_CHAPTERS[XIANGQI_ENDGAMES_EXERCISE_ID]).toBeDefined();
    // Red to move, and the database's mate is five Red moves, as the page says.
    const check = XIANGQI_ENDGAME_HUB_CHECKS.find((row) => row.id === XIANGQI_ENDGAMES_EXERCISE_ID);
    expect(check?.result).toBe('win');
    expect(check?.distance).toBe(9);
    expect(ENDGAME_PAGE_TEXT.exerciseCaption.en).toContain('mate in five');
  });
});
