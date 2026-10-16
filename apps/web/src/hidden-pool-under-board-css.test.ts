import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The face-down tally under the flip-jungle and banqi boards (live-review.css).
// The stylesheet is not applied in this environment, so these pin the CSS text
// (same approach as game-shell-room-css.test.ts). Brian, 2026-10-03: the side
// with eight discs wrapped under its label, so Blue and Red sat at different
// heights.
const cssPath = ['src/live-review.css', 'apps/web/src/live-review.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const css = readFileSync(cssPath as string, 'utf8');
const UNDER_BOARD = '.hidden-pool--under-board';

function ruleBodies(suffix: string): string[] {
  const bodies: string[] = [];
  const pattern = new RegExp(
    `${UNDER_BOARD.replace(/[.-]/g, '\\$&')}\\s*${suffix}\\s*\\{([^}]*)\\}`,
    'g',
  );
  for (const match of css.matchAll(pattern)) bodies.push(match[1] ?? '');
  return bodies;
}

describe('face-down tally under the board', () => {
  it('stacks each side as label over discs, so both sides start on one line', () => {
    expect(ruleBodies('\\.hidden-pool__row')[0]).toContain('flex-direction: column;');
  });

  it('sizes the discs off the side so eight fit on one line', () => {
    const [sideBySide, stacked] = ruleBodies('\\.hidden-pool__pieces');
    expect(sideBySide).toContain('calc((100cqw - 21px) / 8)');
    expect(stacked).toContain('calc((100cqw - 21px - 3.2em - 6px) / 8)');
  });

  it('stacks the sides under a narrow board instead of squeezing them', () => {
    expect(ruleBodies('')[0]).toContain('repeat(auto-fit, minmax(min(100%, 229px), 1fr))');
    expect(css).toContain('@container hidden-pool (width < 482px)');
  });
});
