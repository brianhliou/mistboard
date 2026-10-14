import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Banqi's captured discs in the right rail (#546, live-review.css). The
// stylesheet is not applied in this environment, so this pins the CSS text, as
// hidden-pool-under-board-css.test.ts does.
const cssPath = ['src/live-review.css', 'apps/web/src/live-review.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const css = readFileSync(cssPath as string, 'utf8');

function banqiRailRule(): string | undefined {
  const match = css.match(
    /\.live-route--banqi \.live-review__cluster \.rail-material\s*\{([^}]*)\}/,
  );
  return match?.[1];
}

describe('banqi captured discs in the rail', () => {
  it('sizes them off the board, near the board disc, not the small base clamp', () => {
    expect(banqiRailRule()).toContain('calc(var(--uni-board-width) * 0.102)');
  });

  it("caps them so a side's seven roles still fit one row", () => {
    expect(banqiRailRule()).toContain('calc((100cqw - 20px) / 7)');
  });
});
