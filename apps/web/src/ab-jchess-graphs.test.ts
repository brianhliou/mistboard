import { describe, expect, it } from 'vitest';
import { abJchessArticle } from './articles/content/ab-jchess.js';
import {
  COSTS_MATCH_108,
  COSTS_STALEMATE,
  COSTS_TRAP,
} from './articles/content/ab-jchess-costs.js';

// The post's paragraph and table quote the move-cost data; each claim is pinned
// here so a regenerated file that moves a number fails before the prose does.
const at = (
  d: typeof COSTS_TRAP | typeof COSTS_STALEMATE | typeof COSTS_MATCH_108,
  moveNo: number,
) => {
  const m = d.moves.find((v) => v.moveNo === moveNo);
  expect(m, `move ${moveNo} is in the data`).toBeTruthy();
  return m as { moveNo: number; loss: number; drop: number; mark: string | null };
};
const pct = (p: number) => Math.round(p * 100);

describe('AB-JChess post: move-cost charts', () => {
  const blocks = abJchessArticle.sections.flatMap((s) => s.blocks ?? []);

  it('puts one cost chart and one review link under each embedded game', () => {
    const embeds = blocks.flatMap((b, i) => (b.kind === 'embed' ? [i] : []));
    expect(embeds).toHaveLength(3);
    for (const i of embeds) {
      const room = (blocks[i] as { path: string }).path.split('/')[3].split('?')[0];
      expect(blocks[i + 1]).toMatchObject({
        kind: 'raw-svg',
        className: 'article-figure-move-cost',
      });
      expect((blocks[i + 2] as { text: string }).text).toContain(`(/jieqi/game/${room})`);
    }
  });

  it("has every one of Pikafish's moves, once, in order", () => {
    for (const [d, count] of [
      [COSTS_TRAP, 14],
      [COSTS_STALEMATE, 63],
      [COSTS_MATCH_108, 12],
    ] as const) {
      expect(d.moves.map((m) => m.moveNo)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });

  // The table's "to the bet" column: each reveal's ?? and its price.
  it('prices the three reveals as the table says: 34, 33 and 51 points, each a ??', () => {
    for (const [d, moveNo, bet] of [
      [COSTS_TRAP, 14, 34],
      [COSTS_STALEMATE, 11, 33],
      [COSTS_MATCH_108, 12, 51],
    ] as const) {
      const m = at(d, moveNo);
      expect(pct(m.loss)).toBe(bet);
      expect(m.mark).toBe('??');
    }
  });

  it('game 1: the reveal is the only move that cost the bot anything to speak of', () => {
    for (const m of COSTS_TRAP.moves) {
      if (m.moveNo !== 14) expect(m.loss).toBeLessThan(0.05);
    }
  });

  it('the table matches the data: chances lost = bet + draw', () => {
    const table = blocks.find((b) => b.kind === 'table') as { rows: string[][] } | undefined;
    expect(table).toBeTruthy();
    const rows = table?.rows ?? [];
    const reveals = [at(COSTS_MATCH_108, 12), at(COSTS_TRAP, 14), at(COSTS_STALEMATE, 11)];
    rows.forEach((row, i) => {
      const [total, bet, draw] = row.slice(1).map((c) => Number.parseInt(c, 10));
      expect(total).toBe(pct(reveals[i].drop));
      expect(bet).toBe(pct(reveals[i].loss));
      expect(total).toBe(bet + draw);
    });
  });
});
