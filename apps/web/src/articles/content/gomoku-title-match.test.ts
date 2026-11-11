// The Gomoku title match record (gomoku-title-match.json, recomputed from the
// lab's per-game files) feeds the champions card and the rapfi-vs-katagomo post.
// These checks hold the record to itself, replay the featured game, and check
// that the post states the record's numbers, so an edit to either cannot drift
// unseen.

import { describe, expect, it } from 'vitest';
import { articleProse } from '../../article-prose.js';
import match from './gomoku-title-match.json' with { type: 'json' };
import {
  FEATURED_FIVE,
  FEATURED_LAST,
  FEATURED_RAPFI_MOVES,
  featuredGameState,
  KATAGOMO_SCORE,
  LEVEL8_SHARE,
  rapfiVsKatagomoArticle,
  UNEVEN_TIME_RATIO,
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
    // KataGomo needed 55% in either match; the paired range keeps Rapfi above 55% itself.
    expect(KATAGOMO_SCORE.uneven).toBeLessThan(0.55);
    expect(KATAGOMO_SCORE.equal).toBeLessThan(0.55);
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
  const u = match.uneven.total;
  const e = match.equal.total;

  it('states the record numbers', () => {
    for (const text of [
      `${e.wins} wins, ${e.draws} draws and ${e.losses} losses`,
      `${u.wins}-${u.draws}-${u.losses}`,
      `+${e.elo} Elo`,
      `+${e.eloLow} to +${e.eloHigh}`,
      `${u.eloLow} to +${u.eloHigh}`,
      '80,000 positions',
      '450,000 positions',
      `${match.uneven.katagomoBudget.maxVisits} visits`,
      `about ${UNEVEN_TIME_RATIO} times as long`,
      `about ${LEVEL8_SHARE} times`,
      '72%',
      '28%',
      '51%',
    ]) {
      expect(prose, text).toContain(text);
    }
  });

  it('derived ratios match the record', () => {
    expect(UNEVEN_TIME_RATIO).toBe(11);
    expect(LEVEL8_SHARE).toBe(6);
  });
});
