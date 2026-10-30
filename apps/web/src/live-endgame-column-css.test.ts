import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The desktop game table holds one height from the first move to the result
// (live-review.css). Brian, 2026-10-30: the post-game Rematch and links grew
// the right column by ~140px and pushed the bottom clock down; they now take
// their space from the move list. The stylesheet is not applied in this
// environment, so these pin the CSS text (same approach as
// hidden-pool-under-board-css.test.ts); measured in the browser at 1440 the
// box is 400px both in game and at game over.
const cssPath = ['src/live-review.css', 'apps/web/src/live-review.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
// Comments dropped so a rule's selector text starts at the selector.
const css = readFileSync(cssPath as string, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const NOT_MAHJONG =
  '.live-review__cluster:not(:is(.live-route--mahjong, .live-route--xiangqi-mahjong) *)';

/** The body of the first rule whose selector (whitespace collapsed) is `selector`. */
function rule(selector: string): { body: string; index: number } {
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (flat(match[1] ?? '') === selector) return { body: match[2] ?? '', index: match.index ?? 0 };
  }
  throw new Error(`no rule for ${selector}`);
}

/** The top-level @media that opens before `index`. */
function mediaAt(index: number): string {
  const opens = [...css.slice(0, index).matchAll(/^@media[^{]*/gm)];
  return (opens.at(-1)?.[0] ?? '').trim();
}

describe('desktop game table height', () => {
  it('gives the table one floor height from game start, on desktop only', () => {
    const vars = rule(NOT_MAHJONG);
    expect(vars.body).toMatch(/--live-table-h:\s*400px;/);
    const box = rule(`${NOT_MAHJONG} .round-table__box`);
    expect(box.body).toContain('min-height: var(--live-table-h);');
    expect(mediaAt(box.index)).toBe('@media (min-width: 800px)');
  });

  it('lets the move list take what the other rows leave, so the actions shrink it instead of the column', () => {
    const moves = rule(`${NOT_MAHJONG} .replay-console .game-table-moves`);
    expect(moves.body).toContain('flex: 1 1 0px;');
    expect(moves.body).toContain('max-height: none;');
    expect(mediaAt(moves.index)).toBe('@media (min-width: 800px)');
  });

  it('keeps the post-game actions compact on desktop', () => {
    const links = rule(
      '.live-review__cluster .round-table__box .room-actions .postgame-actions > a, .live-review__cluster .round-table__box .room-actions .postgame-actions > button',
    );
    expect(links.body).toContain('min-height: 30px;');
    expect(mediaAt(links.index)).toBe('@media (min-width: 800px)');
    const grid = rule('.live-review__cluster .round-table__box .room-actions .postgame-actions');
    // Stacked one to a row, not side by side (Brian, 2026-10-30).
    expect(grid.body).not.toContain('grid-template-columns');
  });
});
