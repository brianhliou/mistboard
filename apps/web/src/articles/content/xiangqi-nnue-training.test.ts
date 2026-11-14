// The xiangqi own-net post reads every number from
// xiangqi-nnue-training-numbers.json, which copies the run log. These checks
// hold the record to itself (each Elo from its won/drawn/lost counts, each
// interval around its point) and the prose to the record, and keep the house
// rules for xiangqi copy.

import { describe, expect, it } from 'vitest';
import { eloCell, signed, XIANGQI_NNUE_NUMBERS as N, xiangqiNnueTrainingArticle } from './xiangqi-nnue-training.js';

const eloOf = (w: number, d: number, l: number): number => {
  const score = (w + d / 2) / (w + d + l);
  return -400 * Math.log10(1 / score - 1);
};

const text = JSON.stringify(xiangqiNnueTrainingArticle);

const matches = [
  ...N.scale.matches,
  N.rig.planted,
  ...N.student.arms,
  N.student.headToHead,
  N.gate,
].map((m) => ({ label: 'label' in m ? m.label : 'record', ...m }));

describe('xiangqi own-net post record', () => {
  it.each(matches)('$label: Elo matches its won/drawn/lost counts', (m) => {
    expect(Math.abs(eloOf(m.wins, m.draws, m.losses) - m.elo)).toBeLessThan(0.15);
  });

  it.each([...matches, ...N.recipeCheck])('$label: the point sits inside its interval', (m) => {
    expect(m.lo).toBeLessThan(m.elo);
    expect(m.elo).toBeLessThan(m.hi);
  });

  it('student matches are 500 pairs each, the gate 894 games', () => {
    for (const a of [...N.student.arms, N.student.headToHead]) {
      expect(a.wins + a.draws + a.losses).toBe(N.student.pairs * 2);
    }
    expect(N.gate.wins + N.gate.draws + N.gate.losses).toBe(N.gate.games);
  });

  it('the teacher gap is the CC0 loss minus the Px0 loss', () => {
    expect(N.teacher.cc0 - N.teacher.px0).toBeCloseTo(N.teacher.gap, 4);
    expect(N.teacher.gapLo).toBeLessThan(N.teacher.gap);
    expect(N.teacher.gap).toBeLessThan(N.teacher.gapHi);
    expect(N.teacher.constant).toBeCloseTo(Math.log(2), 4);
  });

  it('the scale fit sits inside its bootstrap interval', () => {
    expect(N.scale.fittedLo).toBeLessThan(N.scale.fitted);
    expect(N.scale.fitted).toBeLessThan(N.scale.fittedHi);
  });
});

describe('xiangqi own-net post prose', () => {
  it('formats signs with a typographic minus', () => {
    expect(signed(-3.7)).toBe('−3.7');
    expect(signed(55)).toBe('+55.0');
    expect(eloCell(2.7, -2.2, 7.6)).toBe('+2.7 [−2.2, +7.6]');
  });

  it('quotes the record in the TL;DR and headings', () => {
    const tldr = (xiangqiNnueTrainingArticle.tldr ?? []).join(' ');
    expect(tldr).toContain('gained 55 Elo');
    expect(tldr).toContain('cost 171 to 278 Elo');
    expect(tldr).toContain('by 10.8 Elo');
    expect(tldr).toContain('was 2.7 Elo');
    const headings = xiangqiNnueTrainingArticle.sections.map((s) => s.heading);
    expect(headings).toContain('The right scale was worth 55 Elo');
    expect(headings).toContain('At one second a move the gain was 2.7 Elo');
  });

  it('states each scale match on its own, never a difference between them', () => {
    // 94.5 - 34.3 = 60.2: the two Fairy-Stockfish matches must not be chained.
    expect(text).not.toMatch(/\b60(\.2)?\b/);
    for (const m of N.scale.matches) expect(text).toContain(eloCell(m.elo, m.lo, m.hi));
  });

  it('keeps the house rules for public xiangqi copy', () => {
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\bsquares?\b/i);
    expect(text).not.toMatch(/\b(king|rook|knight|pawn)s?\b/i);
    expect(text).not.toMatch(/forge|mistboard-engine|docs-private|official net/i);
  });

  it('ends on its call to action', () => {
    const last = xiangqiNnueTrainingArticle.sections.at(-1)?.blocks?.at(-1);
    expect(last?.kind).toBe('cta');
  });
});
