// The Gomoku title match record (gomoku-title-match.json, recomputed from the
// lab's per-game files) feeds the champions card and the rapfi-vs-katagomo post.
// These checks hold the record to itself, replay the featured game, and check
// that the post states the record's numbers, so an edit to either cannot drift
// unseen.

import { describe, expect, it } from 'vitest';
import { articleProse } from '../../article-prose.js';
import decisive from './gomoku-title-decisive.json' with { type: 'json' };
import match from './gomoku-title-match.json' with { type: 'json' };
import {
  FEATURED_FIVE,
  FEATURED_LAST,
  FEATURED_RAPFI_MOVES,
  featuredGameState,
  KATAGOMO_SCORE,
  LEVEL8_SHARE,
  PARTED,
  PARTED_AT_STONES,
  RAPFI_KATAGOMO_STUDY,
  rapfiVsKatagomoArticle,
  VOIDED_MS,
} from './rapfi-vs-katagomo.js';

type Wdl = { games: number; wins: number; draws: number; losses: number };
const elo = (p: number): number => -400 * Math.log10(1 / p - 1);
const score = (r: Wdl): number => (r.wins + r.draws / 2) / r.games;
const sum = (rows: Wdl[]): Wdl =>
  rows.reduce(
    (a, r) => ({
      games: a.games + r.games,
      wins: a.wins + r.wins,
      draws: a.draws + r.draws,
      losses: a.losses + r.losses,
    }),
    { games: 0, wins: 0, draws: 0, losses: 0 },
  );
const wdlOf = ({ games, wins, draws, losses }: Wdl): Wdl => ({ games, wins, draws, losses });

describe('gomoku title match record', () => {
  for (const key of ['uneven', 'equal'] as const) {
    const t = match[key].total;
    it(`${key}: totals, colours and endings add up`, () => {
      expect(t.wins + t.draws + t.losses).toBe(t.games);
      expect(sum([t.rapfiAsBlack, t.rapfiAsWhite])).toEqual(wdlOf(t));
      expect(Object.values(t.endings).reduce((a, b) => a + b, 0)).toBe(t.games);
      // Every decisive game ended in a five; every draw filled the board.
      expect(t.endings.five).toBe(t.wins + t.losses);
      expect(t.endings['board-full']).toBe(t.draws);
    });

    it(`${key}: score and Elo follow from the counts, inside the paired range`, () => {
      expect(t.score).toBeCloseTo(score(t), 4);
      expect(t.elo).toBe(Math.round(elo(score(t))));
      expect(t.eloLow).toBe(Math.round(elo(t.pairedScoreLow)));
      expect(t.eloHigh).toBe(Math.round(elo(t.pairedScoreHigh)));
      expect(t.pairedScoreLow).toBeLessThan(t.pairedScore);
      expect(t.pairedScore).toBeLessThan(t.pairedScoreHigh);
      expect(t.eloLow).toBeLessThan(t.elo);
      expect(t.elo).toBeLessThan(t.eloHigh);
    });
  }

  it('the two first-match runs make up its total', () => {
    const runs = match.uneven.runs;
    expect(sum(runs)).toEqual(wdlOf(match.uneven.total));
    expect(match.uneven.total.pairs * 2).toBe(match.uneven.total.games);
  });

  it('the rematch counts every game it played but the voided one', () => {
    const e = match.equal;
    expect(e.played).toBe(e.total.games + 1);
    // The voided game's pair drops out of the paired range only.
    expect(e.total.pairs).toBe(e.played / 2 - 1);
    expect(VOIDED_MS).toBeGreaterThan(e.rapfiBudget.timeMs);
  });

  it('the title result clears the bar the champions page states', () => {
    // KataGomo needed 55%; the paired range keeps Rapfi above 55% itself.
    expect(KATAGOMO_SCORE).toBeLessThan(0.55);
    expect(match.equal.total.pairedScoreLow).toBeGreaterThan(0.55);
  });

  it('the featured game replays to the five the post describes', () => {
    const f = match.featured;
    expect(f.match).toBe('equal');
    expect(f.rapfiColor).toBe('white');
    const final = featuredGameState();
    expect(final.status).toMatchObject({ type: 'finished', winner: 'white', reason: 'five' });
    expect(f.winner).toBe('white');
    expect(f.reason).toBe('five');
    // No earlier position was already over.
    expect(featuredGameState(f.moves.length - 1).status.type).not.toBe('finished');
    // Black moved first, so White (Rapfi) played every second move.
    expect(f.opening.turn).toBe('black');
    expect(FEATURED_RAPFI_MOVES).toBe(f.moves.length / 2);
    const white = new Set(f.moves.filter((_, i) => i % 2 === 1));
    expect(FEATURED_FIVE.every((sq) => white.has(sq))).toBe(true);
    expect(FEATURED_FIVE).toContain(FEATURED_LAST);
  });
});

describe('rapfi-vs-katagomo prose', () => {
  const prose = articleProse(rapfiVsKatagomoArticle)
    .map((x) => x.text)
    .join('\n');
  const e = match.equal.total;

  it('states the record numbers', () => {
    for (const text of [
      `${e.wins} wins, ${e.draws} draws and ${e.losses} losses`,
      `+${e.elo} Elo`,
      `+${e.eloLow} to +${e.eloHigh}`,
      '80,000 positions',
      '450,000 positions',
      `${e.timing.katagomoVisitsMedian} visits`,
      `about ${LEVEL8_SHARE} times`,
      '72%',
      '28%',
    ]) {
      expect(prose, text).toContain(text);
    }
  });

  it('joins scores with non-breaking hyphens so a line never wraps mid-score', () => {
    expect(prose).not.toMatch(/\d+-\d+-\d+/);
  });

  it('gives the earlier matched-search match one sentence, its result only', () => {
    const u = match.uneven.total;
    const sentences = prose.split(/(?<=[.:])\s+/).filter((x) => x.includes(`${u.wins}\u2011${u.draws}\u2011${u.losses}`));
    expect(sentences).toHaveLength(1);
    expect(prose).toContain(
      `KataGomo at ${match.uneven.katagomoBudget.maxVisits} visits, the two scored level: ${u.wins}\u2011${u.draws}\u2011${u.losses} over ${u.games} games`,
    );
    expect(prose.match(new RegExp(`${match.uneven.katagomoBudget.maxVisits} visits`, 'g'))).toHaveLength(1);
    // No table, Elo range or TL;DR line for it.
    expect(prose).not.toContain(`${u.eloLow} to`);
    expect(rapfiVsKatagomoArticle.tldr?.join(' ')).not.toContain(`${u.wins}\u2011${u.draws}\u2011${u.losses}`);
    expect(prose).not.toMatch(/rematch/i);
  });

  it('frames the title on the CPUs the site serves from', () => {
    expect(prose).toContain('On the CPUs Mistboard serves from, Rapfi is the stronger engine.');
    expect(prose).toContain(`on its ${match.katagomo.backend} backend`);
    expect(prose).toContain('one CPU thread');
  });

  it('tables the title result from the record', () => {
    const table = rapfiVsKatagomoArticle.sections
      .flatMap((s) => s.blocks ?? [])
      .find((b) => b.kind === 'table');
    expect(table?.kind === 'table' ? table.rows[0]?.[1] : null).toBe(`${e.wins}\u2011${e.draws}\u2011${e.losses}`);
  });

  it('derived ratios match the record', () => {
    expect(LEVEL8_SHARE).toBe(6);
  });

  it('shows game 1 from the match study, opened on its last move', () => {
    const embeds = rapfiVsKatagomoArticle.sections.flatMap((s) =>
      (s.blocks ?? []).flatMap((b) => (b.kind === 'embed' ? [b.path] : [])),
    );
    expect(embeds).toEqual([
      `/embed/study/${RAPFI_KATAGOMO_STUDY.id}/${RAPFI_KATAGOMO_STUDY.chapters.featured}?ply=${match.featured.moves.length}`,
    ]);
    expect(RAPFI_KATAGOMO_STUDY.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(RAPFI_KATAGOMO_STUDY.chapters.featured).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });
});

describe('why the title games are decisive (gomoku-title-decisive.json)', () => {
  const prose = articleProse(rapfiVsKatagomoArticle)
    .map((x) => x.text)
    .join('\n');
  const L = decisive.lengths;
  const pctOf = (x: number) => `${Math.round(x * 100)}%`;

  it('holds the record to itself and to the match record', () => {
    expect(L.decisive + L.draws).toBe(decisive.games);
    expect(L.bins.reduce((a, b) => a + b.games, 0)).toBe(L.decisive);
    expect(L.drawMovesMin).toBe(L.drawMoves);
    const e = match.equal.total;
    expect(decisive.games).toBe(e.games);
    expect(L.draws).toBe(e.draws);
    expect(L.decisive).toBe(e.endings.five);
    expect(L.draws).toBe(e.endings['board-full']);
    expect(decisive.losses.games).toBe(e.losses);
    expect(decisive.forcedWin.rapfiWins).toBe(e.wins);
    for (const line of [decisive.trajectory.wins, decisive.trajectory.draws, decisive.trajectory.losses]) {
      for (const p of line) {
        expect(p.chance).toBeGreaterThanOrEqual(0);
        expect(p.chance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('states the record numbers', () => {
    const a = decisive.attack;
    for (const text of [
      `${L.decisive} of the ${decisive.games} games ended in a five, at a median of ${L.decisiveMedian} moves`,
      `All ${L.draws} draws ran the full ${L.drawMoves} moves`,
      `by stone ${PARTED_AT_STONES}`,
      `${pctOf(PARTED.wins)} in its eventual wins, ${pctOf(PARTED.draws)} in the draws and ${pctOf(PARTED.losses)} in its losses`,
      `a median stone ${decisive.forcedWin.medianStone}`,
      `Its ${decisive.losses.games} losses`,
      `In the ${decisive.losses.read} with logged readings`,
      `a median ${pctOf(decisive.losses.bestChanceMedian)}`,
      `only ${decisive.losses.aboveSeventy} went above 70%`,
      `${((a.rapfi.fours / a.rapfi.moves) * 100).toFixed(1)}% of its moves made a four`,
      `${((a.katagomo.fours / a.katagomo.moves) * 100).toFixed(1)}% of KataGomo's`,
      `${a.rapfi.doubleThreats} moves with two threats at once to KataGomo's ${a.katagomo.doubleThreats}`,
      `anywhere from ${pctOf(decisive.katagomoView.openings.blackMin)} to ${pctOf(decisive.katagomoView.openings.blackMax)}`,
      `put ${decisive.katagomoView.openings.outsideFortySixty} of the ${decisive.katagomoView.openings.read} outside 40-60%`,
      `in the ${decisive.katagomoView.openings.high.openings} openings it gave Black over 60%, Black scored ${pctOf(decisive.katagomoView.openings.high.blackScore)}`,
      `in the ${decisive.katagomoView.openings.low.openings} it gave Black under 40%, Black scored ${pctOf(decisive.katagomoView.openings.low.blackScore)}`,
      `In ${decisive.katagomoView.rapfiWins.sample} of Rapfi's wins`,
      `a median ${pctOf(decisive.katagomoView.rapfiWins.chanceMedian)}`,
      `it still gave itself ${pctOf(decisive.katagomoView.rapfiWins.deepChanceMedian)}`,
      `about ${Math.round(decisive.edges.colour * 100)} points of score`,
      `being Rapfi about ${Math.round(decisive.edges.engine * 100)}`,
    ]) {
      expect(prose, text).toContain(text);
    }
  });

  it('pins the figures the coordinator read from the analysis', () => {
    // A re-run of the analysis that moves these must be re-read in the prose.
    expect(L.decisiveMedian).toBe(44.5);
    expect(decisive.forcedWin.medianStone).toBe(22);
    expect(decisive.losses.bestChanceMedian).toBe(0.53);
    expect(decisive.katagomoView.openings.outsideFortySixty).toBe(34);
    expect(decisive.katagomoView.rapfiWins.chanceMedian).toBe(0.244);
  });

  it('draws both charts from the record', () => {
    const svgs = rapfiVsKatagomoArticle.sections.flatMap((s) =>
      (s.blocks ?? []).flatMap((b) => (b.kind === 'raw-svg' ? [b.svg] : [])),
    );
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toContain(`median ${L.decisiveMedian} moves`);
    expect(svgs[0]).toContain(`Draws: ${L.draws} games, ${L.drawMoves} moves each`);
    expect(svgs[1]).toContain('Rapfi won');
    expect(svgs[1]).toContain('Rapfi lost');
  });
});
