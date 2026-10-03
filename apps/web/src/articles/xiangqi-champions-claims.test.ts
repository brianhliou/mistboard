import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '@mistboard/board-render';
import { xiangqiChampionsArticle } from './content/xiangqi-champions.js';
import { xiangqiWorldChampionshipArticle } from './content/xiangqi-world-championship.js';

// Superlatives in this article have been wrong three separate times: a caption
// called a 70-ply game the shortest when a 60-ply game was two sections below,
// a 183-ply game the longest when a 217-ply game sat at the foot of the page,
// and a game "faulted more than most" when the engine faulted it less. Prose
// and data drift apart silently, so the claims are asserted here against the
// specs the page actually renders.

type Spec = { iccs: string; annotations?: { byPly: Record<number, { glyph?: string }> } };

function specs(): Array<{ caption: string; plies: number; blunders: number; mistakes: number }> {
  const out: Array<{ caption: string; plies: number; blunders: number; mistakes: number }> = [];
  for (const section of xiangqiChampionsArticle.sections) {
    for (const block of section.blocks ?? []) {
      if (block.kind !== 'xq-replay') continue;
      const spec = block.spec as unknown as Spec;
      const glyphs = Object.values(spec.annotations?.byPly ?? {}).map((a) => a.glyph);
      out.push({
        caption: block.caption ?? '',
        plies: spec.iccs.trim().split(/\s+/).length,
        blunders: glyphs.filter((g) => g === '??').length,
        mistakes: glyphs.filter((g) => g === '?').length,
      });
    }
  }
  return out;
}

function prose(): string {
  const parts: string[] = [xiangqiChampionsArticle.summary ?? ''];
  for (const block of xiangqiChampionsArticle.intro ?? []) {
    if (block.kind === 'paragraph') parts.push(block.text);
  }
  for (const section of xiangqiChampionsArticle.sections) {
    parts.push(section.heading);
    for (const block of section.blocks ?? []) {
      if (block.kind === 'paragraph') parts.push(block.text);
      if (block.kind === 'cta') for (const b of block.buttons) parts.push(b.label);
      if ('caption' in block && block.caption) parts.push(block.caption);
    }
  }
  return parts.join('\n');
}

describe('claims the article makes about its own games', () => {
  it('gives the shortest and longest game to the games that are actually those', () => {
    const games = specs();
    const shortest = Math.min(...games.map((g) => g.plies));
    const longest = Math.max(...games.map((g) => g.plies));

    const claimsShortest = games.filter((g) => /shortest game/.test(g.caption));
    expect(claimsShortest).toHaveLength(1);
    expect(claimsShortest[0]?.plies).toBe(shortest);

    // "longest" is qualified (the longest *national championship* game), so any
    // unqualified claim must belong to the outright longest game.
    for (const game of games) {
      if (/longest game (on|here)/.test(game.caption)) expect(game.plies).toBe(longest);
    }
  });

  it('claims a blunder-and-mistake-free game only for one that is', () => {
    const games = specs();
    const clean = games.filter((g) => g.blunders === 0 && g.mistakes === 0);
    const claimed = games.filter((g) => /neither a blunder nor a mistake/.test(g.caption));
    expect(claimed).toHaveLength(1);
    expect(clean).toHaveLength(1);
    expect(claimed[0]?.caption).toBe(clean[0]?.caption);
  });

  it('never claims a game is faulted more than the others without it being true', () => {
    const games = specs();
    for (const game of games) {
      if (!/faults (both players )?more/.test(game.caption)) continue;
      const judged = game.blunders + game.mistakes;
      const median = games
        .map((g) => g.blunders + g.mistakes)
        .sort((a, b) => a - b)[Math.floor(games.length / 2)] as number;
      expect(judged).toBeGreaterThan(median);
    }
  });
});

describe('claims about who is clean', () => {
  it('matches the sanction data', () => {
    const since2005 = CHAMPIONS.filter((c) =>
      [...c.years, ...(c.shared ?? [])].some((y) => y >= 2005),
    );
    const clean = since2005.filter((c) => !c.sanction);
    const text = prose();

    // Assert the numbers, not the sentences: the prose gets rewritten and the
    // point of this test is that the counts stay true, not that the wording
    // stays frozen. The words are what a reader sees, so the words are checked.
    const asWord: Record<number, string> = {
      3: 'three',
      10: 'ten',
      13: 'thirteen',
    };
    expect(since2005).toHaveLength(13);
    expect(clean).toHaveLength(3);
    const lower = text.toLowerCase();
    for (const n of [since2005.length, since2005.length - clean.length, clean.length]) {
      const word = asWord[n];
      expect(word, `no word form for ${n}`).toBeTruthy();
      expect(lower, `the page never says "${word}" for ${n}`).toContain(word as string);
    }
    // Every unsanctioned champion is named, so the exceptions are not left vague.
    for (const champ of clean) expect(text).toContain(champ.name);
  });
});

describe('structured data', () => {
  it('lists every champion, in the order the page presents them', () => {
    // Hand-writing twenty-two names into JSON-LD is a second copy that drifts
    // from the figure and the table without anything noticing.
    const nodes = xiangqiChampionsArticle.structuredData?.() ?? [];
    const list = nodes.find((n) => n['@type'] === 'ItemList') as
      | { numberOfItems: number; itemListElement: Array<{ position: number; item: { name: string; alternateName: string } }> }
      | undefined;
    expect(list, 'the article should declare an ItemList').toBeDefined();
    expect(list?.numberOfItems).toBe(CHAMPIONS.length);
    expect(list?.itemListElement).toHaveLength(CHAMPIONS.length);
    list?.itemListElement.forEach((entry, index) => {
      expect(entry.position).toBe(index + 1);
      expect(entry.item.name).toBe(CHAMPIONS[index]?.name);
      expect(entry.item.alternateName).toBe(CHAMPIONS[index]?.zh);
    });
  });
});

describe('counts the page states about itself', () => {
  const NUMBER_WORDS: Record<string, number> = {
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
  };

  function boards(): number {
    let n = 0;
    for (const section of xiangqiChampionsArticle.sections) {
      for (const block of section.blocks ?? []) if (block.kind === 'xq-replay') n += 1;
    }
    return n;
  }

  it('never offers a number of games that disagrees with the boards it renders', () => {
    // The world final moved to the companion article and took a board with it,
    // leaving a CTA that still offered "all sixteen games" on a page of fifteen.
    //
    // Scoped to CTA labels on purpose. A first pass scanned all prose and
    // failed on "did not draw a single one of his thirteen games", which is a
    // player's 1981 season and not a claim about this page at all; a check that
    // cries wolf on correct sentences gets deleted by the next person.
    const labels: string[] = [];
    for (const section of xiangqiChampionsArticle.sections) {
      for (const block of section.blocks ?? []) {
        if (block.kind === 'cta') for (const b of block.buttons) labels.push(b.label);
      }
    }
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      for (const [word, value] of Object.entries(NUMBER_WORDS)) {
        if (!new RegExp(`\\b${word}\\b.*\\bgames?\\b`, 'i').test(label)) continue;
        expect(value, `the button says "${label}" but the page renders ${boards()} boards`).toBe(
          boards(),
        );
      }
    }
  });

  it('states annotation totals that the boards on both champion pages add up to', () => {
    // The totals came over from the blog post this page absorbed, where they
    // were counted once by hand. They cover this page AND the world-title page,
    // so they are recomputed from both pages' specs: re-annotating or moving a
    // game between the two pages must move the numbers or fail here.
    let games = 0;
    let mainline = 0;
    let judged = 0;
    let sidelines = 0;
    let sidelineMoves = 0;
    const glyphs: Record<string, number> = {};
    for (const article of [xiangqiChampionsArticle, xiangqiWorldChampionshipArticle]) {
      for (const section of article.sections) {
        for (const block of section.blocks ?? []) {
          if (block.kind !== 'xq-replay') continue;
          const spec = block.spec as unknown as {
            iccs: string;
            annotations?: { byPly: Record<number, { glyph?: string; line?: string }> };
          };
          games += 1;
          mainline += spec.iccs.trim().split(/\s+/).length;
          for (const ann of Object.values(spec.annotations?.byPly ?? {})) {
            judged += 1;
            glyphs[ann.glyph ?? ''] = (glyphs[ann.glyph ?? ''] ?? 0) + 1;
            if (ann.line) {
              sidelines += 1;
              sidelineMoves += ann.line.trim().split(/\s+/).length;
            }
          }
        }
      }
    }
    const count = (...gs: string[]) => gs.reduce((n, g) => n + (glyphs[g] ?? 0), 0);
    const fmt = (n: number) => n.toLocaleString('en-US');

    const section = xiangqiChampionsArticle.sections.find(
      (s) => s.heading === 'How the games were annotated',
    );
    expect(section, 'the annotation section should exist').toBeDefined();
    const table = section?.blocks?.find((b) => b.kind === 'table') as
      | { rows: string[][] }
      | undefined;
    const cell = (label: string) => table?.rows.find((r) => r[0] === label)?.[1];
    expect(cell('games annotated')).toBe(fmt(games));
    expect(cell('mainline moves')).toBe(fmt(mainline));
    expect(cell('moves judged worth marking')).toBe(fmt(judged));
    expect(cell('engine sidelines')).toBe(fmt(sidelines));
    expect(cell('moves inside those sidelines')).toBe(fmt(sidelineMoves));
    expect(cell('moves in the published trees')).toBe(fmt(mainline + sidelineMoves));

    const text = prose();
    expect(text).toContain(`that comes to ${games} games`);
    expect(text).toContain(`Of the ${judged} moves judged, ${count('?!')} are inaccuracies`);
    expect(text).toContain(`${count('?', '??')} are mistakes or blunders`);
    expect(text).toContain(`${count('!', '!!')} are moves the engine wanted to praise`);
    expect(count('!!')).toBe(3);
    expect(text).toContain('three of them marked brilliant');
  });

  it('promises one game per champion for as many champions as it profiles', () => {
    const profiled = xiangqiChampionsArticle.sections.filter((s) =>
      /, (?:19|20)\d\d$/.test(s.heading),
    ).length;
    expect(prose()).toContain('thirteen');
    expect(profiled).toBe(13);
    // Two champions carry a second game, so boards exceed champions by exactly that.
    expect(boards()).toBe(profiled + 2);
  });
});
